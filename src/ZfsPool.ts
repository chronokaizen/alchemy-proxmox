import * as Effect from "effect/Effect";
import { isResolved } from "alchemy/Diff";
import * as Provider from "alchemy/Provider";
import { Resource } from "alchemy/Resource";
import { createProxmoxClient, isProxmoxNotFound, type ProxmoxClient } from "./client.js";
import { withoutUndefined, type ProxmoxProviderOptions } from "./config.js";
import type { Providers } from "./Providers.js";

export type ZfsRaidLevel =
  | "single"
  | "mirror"
  | "raid10"
  | "raidz"
  | "raidz2"
  | "raidz3"
  | "draid"
  | "draid2"
  | "draid3";

export interface ZfsPoolProps {
  readonly node: string;
  readonly name: string;
  readonly devices: string | readonly string[];
  readonly raidlevel: ZfsRaidLevel;
  readonly addStorage?: boolean;
  readonly ashift?: number;
  readonly compression?: "on" | "off" | "gzip" | "lz4" | "lzjb" | "zle" | "zstd";
  readonly cleanupConfig?: boolean;
  readonly cleanupDisks?: boolean;
  readonly wait?: boolean;
  readonly taskTimeoutMs?: number;
}

export interface ZfsPool
  extends Resource<
    "Proxmox.ZfsPool",
    ZfsPoolProps,
    {
      readonly node: string;
      readonly name: string;
      readonly state?: string;
      readonly status?: string;
      readonly errors?: string;
    },
    never,
    Providers
  > {}

export const ZfsPool = Resource<ZfsPool>("Proxmox.ZfsPool");

export const ZfsPoolProvider = (options: ProxmoxProviderOptions = {}) =>
  Provider.effect(
    ZfsPool,
    Effect.gen(function* () {
      const client = createProxmoxClient(options);

      return ZfsPool.Provider.of({
        stables: ["node", "name"],
        diff: Effect.fn(function* ({ olds, news, output }) {
          if (!isResolved(news)) return;
          if (
            (output?.node ?? olds.node) !== news.node ||
            (output?.name ?? olds.name) !== news.name
          ) {
            return { action: "replace" } as const;
          }
        }),
        read: Effect.fn(function* ({ olds, output }) {
          return yield* readZfsPool(client, output?.node ?? olds.node, output?.name ?? olds.name);
        }),
        reconcile: Effect.fn(function* ({ news }) {
          const existing = yield* readZfsPool(client, news.node, news.name);
          if (!existing) {
            const upid = yield* request<string>(() =>
              client.post(`/nodes/${encodeURIComponent(news.node)}/disks/zfs`, zfsPoolToApiBody(news)),
            );
            yield* waitForTask(client, news.node, upid, news, options);
          }

          const created = yield* readZfsPool(client, news.node, news.name);
          if (!created) {
            return yield* Effect.fail(
              new Error(`Proxmox ZFS pool ${news.name} was not readable after reconcile`),
            );
          }
          return created;
        }),
        delete: Effect.fn(function* ({ olds, output }) {
          const existing = yield* readZfsPool(client, output.node, output.name);
          if (!existing) return;
          const upid = yield* request<string>(() =>
            client.delete(
              `/nodes/${encodeURIComponent(output.node)}/disks/zfs/${encodeURIComponent(output.name)}`,
              {
                "cleanup-config": olds.cleanupConfig,
                "cleanup-disks": olds.cleanupDisks,
              },
            ),
          );
          yield* waitForTask(client, output.node, upid, olds, options);
        }),
      });
    }),
  );

const zfsPoolToApiBody = (props: ZfsPoolProps) =>
  withoutUndefined({
    name: props.name,
    devices: csv(props.devices),
    raidlevel: props.raidlevel,
    add_storage: props.addStorage,
    ashift: props.ashift,
    compression: props.compression,
  });

const readZfsPool = (client: ProxmoxClient, node: string, name: string) =>
  request(async () => {
    try {
      const pool = await client.zfsPool(node, name);
      return {
        node,
        name: pool.name,
        state: pool.state,
        status: pool.status,
        errors: pool.errors,
      };
    } catch (error) {
      if (isProxmoxNotFound(error)) return undefined;
      throw error;
    }
  });

const waitForTask = (
  client: ProxmoxClient,
  node: string,
  upid: string,
  props: Pick<ZfsPoolProps, "wait" | "taskTimeoutMs">,
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

const csv = (value: string | readonly string[]) =>
  Array.isArray(value) ? value.join(",") : value;

const request = <T>(promise: () => Promise<T>) =>
  Effect.tryPromise({
    try: promise,
    catch: (error) => error,
  });
