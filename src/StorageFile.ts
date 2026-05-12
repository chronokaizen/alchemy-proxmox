import { basename } from "node:path";
import { readFile } from "node:fs/promises";
import * as Effect from "effect/Effect";
import { isResolved } from "alchemy/Diff";
import * as Provider from "alchemy/Provider";
import {
  Resource,
  type ResourceClass,
  type ResourceLike,
} from "alchemy/Resource";
import {
  createProxmoxClient,
  isProxmoxNotFound,
  type ProxmoxClient,
  type ProxmoxStorageContent,
} from "./client.js";
import type {
  ProxmoxProviderOptions,
  ProxmoxStorageFileAttributes,
} from "./config.js";
import type { Providers } from "./Providers.js";

type StorageContentType = "iso" | "vztmpl";

type StorageFileAttributes = ProxmoxStorageFileAttributes & {
  readonly content: StorageContentType;
};

type StorageFileResource = ResourceLike<
  string,
  StorageFileProps,
  StorageFileAttributes,
  never,
  Providers
>;

type ChecksumAlgorithm =
  | "md5"
  | "sha1"
  | "sha224"
  | "sha256"
  | "sha384"
  | "sha512";

interface StorageFileSource {
  readonly path?: string;
  readonly url?: string;
  readonly checksum?: string;
  readonly checksumAlgorithm?: ChecksumAlgorithm;
  readonly verifyCertificates?: boolean;
}

interface StorageFileProps extends StorageFileSource {
  readonly node: string;
  readonly storage: string;
  readonly filename?: string;
  readonly deleteOnDestroy?: boolean;
  readonly wait?: boolean;
  readonly taskTimeoutMs?: number;
}

export interface IsoImageProps extends StorageFileProps {}

export interface ContainerTemplateProps extends StorageFileProps {}

export interface IsoImage
  extends Resource<
    "Proxmox.IsoImage",
    IsoImageProps,
    ProxmoxStorageFileAttributes & {
      readonly content: "iso";
    },
    never,
    Providers
  > {}

export interface ContainerTemplate
  extends Resource<
    "Proxmox.ContainerTemplate",
    ContainerTemplateProps,
    ProxmoxStorageFileAttributes & {
      readonly content: "vztmpl";
    },
    never,
    Providers
  > {}

export const IsoImage = Resource<IsoImage>("Proxmox.IsoImage");

export const ContainerTemplate = Resource<ContainerTemplate>(
  "Proxmox.ContainerTemplate",
);

export const IsoImageProvider = (options: ProxmoxProviderOptions = {}) =>
  storageFileProvider(IsoImage, "iso", options);

export const ContainerTemplateProvider = (
  options: ProxmoxProviderOptions = {},
) => storageFileProvider(ContainerTemplate, "vztmpl", options);

const storageFileProvider = <R extends StorageFileResource>(
  resource: ResourceClass<R>,
  content: StorageContentType,
  options: ProxmoxProviderOptions,
) =>
  Provider.effect(
    resource,
    Effect.gen(function* () {
      const client = createProxmoxClient(options);

      return resource.Provider.of({
        stables: [
          "node",
          "storage",
          "filename",
          "content",
          "volid",
        ] as Extract<keyof R["Attributes"], string>[],
        diff: Effect.fn(function* ({ olds, news, output }) {
          if (!isResolved(news)) return;
          const oldProps = olds as StorageFileProps;
          const newProps = news as StorageFileProps;
          if (
            (output?.node ?? oldProps.node) !== newProps.node ||
            (output?.storage ?? oldProps.storage) !== newProps.storage ||
            (output?.filename ?? resolveFilename(oldProps)) !==
              resolveFilename(newProps)
          ) {
            return { action: "replace" } as const;
          }
        }),
        read: Effect.fn(function* ({ olds, output }) {
          const oldProps = olds as StorageFileProps;
          const filename = output?.filename ?? resolveFilename(oldProps);
          return yield* readStorageFile(
            client,
            content,
            oldProps.node,
            oldProps.storage,
            filename,
          );
        }),
        reconcile: Effect.fn(function* ({ news }) {
          const newProps = news as StorageFileProps;
          const filename = resolveFilename(newProps);
          const existing = yield* readStorageFile(
            client,
            content,
            newProps.node,
            newProps.storage,
            filename,
          );
          if (existing) return existing;

          const upid = yield* createStorageFile(
            client,
            content,
            newProps,
            filename,
          );
          yield* waitForTask(client, newProps.node, upid, newProps, options);

          const created = yield* readStorageFile(
            client,
            content,
            newProps.node,
            newProps.storage,
            filename,
          );
          if (!created) {
            return yield* Effect.fail(
              new Error(
                `Proxmox storage file ${volid(newProps.storage, content, filename)} was not found after upload`,
              ),
            );
          }
          return created;
        }),
        delete: Effect.fn(function* ({ olds, output }) {
          const oldProps = olds as StorageFileProps;
          if (!oldProps.deleteOnDestroy) return;

          const existing = yield* readStorageFile(
            client,
            content,
            oldProps.node,
            oldProps.storage,
            output.filename,
          );
          if (!existing) return;

          const upid = yield* request<string | null>(() =>
            client.delete(
              `/nodes/${encodeURIComponent(oldProps.node)}/storage/${encodeURIComponent(oldProps.storage)}/content/${encodeURIComponent(output.volid)}`,
            ),
          );
          if (upid) {
            yield* waitForTask(client, oldProps.node, upid, oldProps, options);
          }
        }),
      });
    }),
  );

const resolveFilename = (props: StorageFileProps) => {
  if (props.filename) return props.filename;
  if (props.path) return basename(props.path);
  if (props.url) return basename(new URL(props.url).pathname);
  throw new Error("filename is required when path or url is not set");
};

const createStorageFile = (
  client: ProxmoxClient,
  content: StorageContentType,
  props: StorageFileProps,
  filename: string,
) =>
  props.url
    ? Effect.gen(function* () {
        const url = props.url!;
        return yield* request(() =>
        client.downloadStorageFileFromUrl(props.node, props.storage, {
          content,
          filename,
          url,
          checksum: props.checksum,
          checksumAlgorithm: props.checksumAlgorithm,
          verifyCertificates: props.verifyCertificates,
        }),
      );
      })
    : props.path
      ? Effect.gen(function* () {
          const bytes = yield* request(() => readFile(props.path!));
          return yield* request(() =>
            client.uploadStorageFile(props.node, props.storage, {
              content,
              filename,
              file: new Blob([bytes]),
              checksum: props.checksum,
              checksumAlgorithm: props.checksumAlgorithm,
            }),
          );
        })
      : Effect.fail(
          new Error(
            "Storage file does not exist; set url or path to create it",
          ),
        );

const readStorageFile = (
  client: ProxmoxClient,
  content: StorageContentType,
  node: string,
  storage: string,
  filename: string,
) =>
  request(async () => {
    try {
      const files = await client.storageContent(node, storage, content);
      const file = files.find((item) => item.volid === volid(storage, content, filename));
      return file ? toAttributes(node, storage, filename, content, file) : undefined;
    } catch (error) {
      if (isProxmoxNotFound(error)) {
        return undefined;
      }
      throw error;
    }
  });

const volid = (storage: string, content: StorageContentType, filename: string) =>
  `${storage}:${content}/${filename}`;

const toAttributes = (
  node: string,
  storage: string,
  filename: string,
  content: StorageContentType,
  file: ProxmoxStorageContent,
) => ({
  node,
  storage,
  filename,
  volid: file.volid,
  format: file.format,
  size: file.size,
  ctime: file.ctime,
  content,
});

const waitForTask = (
  client: ProxmoxClient,
  node: string,
  upid: string,
  props: Pick<StorageFileProps, "wait" | "taskTimeoutMs">,
  options: ProxmoxProviderOptions,
) =>
  props.wait === false
    ? Effect.void
    : request(() =>
        client.waitForTask(node, upid, {
          timeoutMs: props.taskTimeoutMs ?? options.waitTimeoutMs,
          intervalMs: options.waitIntervalMs,
          successExitStatuses: options.successExitStatuses,
        }),
      );

const request = <T>(promise: () => Promise<T>) =>
  Effect.tryPromise({
    try: promise,
    catch: (error) => error,
  });
