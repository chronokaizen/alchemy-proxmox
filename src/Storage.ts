import * as Effect from "effect/Effect";
import { isResolved } from "alchemy/Diff";
import * as Provider from "alchemy/Provider";
import { Resource } from "alchemy/Resource";
import {
  createProxmoxClient,
  isProxmoxNotFound,
  type ProxmoxClient,
  type ProxmoxStorageConfig,
} from "./client.js";
import {
  withoutUndefined,
  type ProxmoxProviderOptions,
} from "./config.js";
import type { Providers } from "./Providers.js";

export type StorageType = "dir" | "zfspool";
export type StorageContent =
  | "images"
  | "rootdir"
  | "iso"
  | "vztmpl"
  | "backup"
  | "snippets"
  | "import";

export interface StorageProps {
  readonly storage: string;
  readonly type: StorageType;
  readonly content: StorageContent | readonly StorageContent[] | string;
  readonly path?: string;
  readonly pool?: string;
  readonly nodes?: string | readonly string[];
  readonly shared?: boolean;
  readonly disable?: boolean;
  readonly sparse?: boolean;
  readonly mountpoint?: string;
  readonly format?: "raw" | "qcow2" | "subvol" | "vmdk";
  readonly createBasePath?: boolean;
  readonly createSubdirs?: boolean;
  readonly extra?: Record<string, string | number | boolean | undefined>;
}

export interface Storage
  extends Resource<
    "Proxmox.Storage",
    StorageProps,
    {
      readonly storage: string;
      readonly type: StorageType;
      readonly content?: string;
      readonly path?: string;
      readonly pool?: string;
      readonly nodes?: string;
      readonly shared?: boolean;
      readonly disable?: boolean;
      readonly sparse?: boolean;
      readonly mountpoint?: string;
      readonly digest?: string;
    },
    never,
    Providers
  > {}

export const Storage = Resource<Storage>("Proxmox.Storage");

export const StorageProvider = (options: ProxmoxProviderOptions = {}) =>
  Provider.effect(
    Storage,
    Effect.gen(function* () {
      const client = createProxmoxClient(options);

      return Storage.Provider.of({
        stables: ["storage", "type"],
        diff: Effect.fn(function* ({ olds, news, output }) {
          if (!isResolved(news)) return;
          if (
            (output?.storage ?? olds.storage) !== news.storage ||
            (output?.type ?? olds.type) !== news.type
          ) {
            return { action: "replace" } as const;
          }
        }),
        read: Effect.fn(function* ({ olds, output }) {
          return yield* readStorage(client, output?.storage ?? olds.storage);
        }),
        reconcile: Effect.fn(function* ({ news }) {
          const existing = yield* readStorage(client, news.storage);
          if (existing) {
            yield* request(() =>
              client.put(
                `/storage/${encodeURIComponent(news.storage)}`,
                storageToApiBody(news, false),
              ),
            );
          } else {
            yield* request(() => client.post("/storage", storageToApiBody(news, true)));
          }

          const created = yield* readStorage(client, news.storage);
          if (!created) {
            return yield* Effect.fail(
              new Error(`Proxmox storage ${news.storage} was not readable after reconcile`),
            );
          }
          return created;
        }),
        delete: Effect.fn(function* ({ output }) {
          const existing = yield* readStorage(client, output.storage);
          if (!existing) return;
          yield* request(() =>
            client.delete(`/storage/${encodeURIComponent(output.storage)}`),
          );
        }),
      });
    }),
  );

const storageToApiBody = (props: StorageProps, includeType: boolean) =>
  withoutUndefined({
    storage: props.storage,
    type: includeType ? props.type : undefined,
    content: csv(props.content),
    path: props.path,
    pool: props.pool,
    nodes: csv(props.nodes),
    shared: props.shared,
    disable: props.disable,
    sparse: props.sparse,
    mountpoint: props.mountpoint,
    format: props.format,
    "create-base-path": props.createBasePath,
    "create-subdirs": props.createSubdirs,
    ...props.extra,
  });

const readStorage = (client: ProxmoxClient, storage: string) =>
  request(async () => {
    try {
      return toAttributes(await client.storageConfig(storage));
    } catch (error) {
      if (isProxmoxNotFound(error)) return undefined;
      throw error;
    }
  });

const toAttributes = (config: ProxmoxStorageConfig): Storage["Attributes"] => ({
  storage: config.storage,
  type: config.type as StorageType,
  content: config.content,
  path: config.path,
  pool: config.pool,
  nodes: config.nodes,
  shared: bool(config.shared),
  disable: bool(config.disable),
  sparse: bool(config.sparse),
  mountpoint: config.mountpoint,
  digest: config.digest,
});

const bool = (value: unknown) =>
  value === undefined ? undefined : value === true || value === 1;

const csv = (value: string | readonly string[] | undefined) =>
  Array.isArray(value) ? value.join(",") : value;

const request = <T>(promise: () => Promise<T>) =>
  Effect.tryPromise({
    try: promise,
    catch: (error) => error,
  });
