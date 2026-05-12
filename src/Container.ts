import * as Effect from "effect/Effect";
import { isResolved } from "alchemy/Diff";
import * as Provider from "alchemy/Provider";
import { Resource } from "alchemy/Resource";
import {
  createProxmoxClient,
  isProxmoxNotFound,
  type ProxmoxClient,
} from "./client.js";
import {
  tagsToString,
  withoutUndefined,
  type ProxmoxCommonProps,
  type ProxmoxGuestAttributes,
  type ProxmoxProviderOptions,
} from "./config.js";
import type { Providers } from "./Providers.js";

export interface ContainerProps extends ProxmoxCommonProps {
  readonly ostemplate: string;
  readonly storage: string;
  readonly rootfs?: string;
  readonly password?: string;
  readonly hostname?: string;
  readonly memory?: number;
  readonly swap?: number;
  readonly cores?: number;
  readonly net0?: string;
  readonly unprivileged?: boolean;
  readonly features?: string;
  readonly onboot?: boolean;
  readonly protection?: boolean;
}

export interface Container
  extends Resource<
    "Proxmox.Container",
    ContainerProps,
    ProxmoxGuestAttributes & {
      readonly type: "lxc";
    },
    never,
    Providers
  > {}

export const Container = Resource<Container>("Proxmox.Container");

export const ContainerProvider = (options: ProxmoxProviderOptions = {}) =>
  Provider.effect(
    Container,
    Effect.gen(function* () {
      const client = createProxmoxClient(options);

      return Container.Provider.of({
        stables: ["node", "vmid", "type"],
        diff: Effect.fn(function* ({ olds, news, output }) {
          if (!isResolved(news)) return;
          if (
            (output?.node ?? olds?.node) !== news.node ||
            (news.vmid !== undefined &&
              (output?.vmid ?? olds?.vmid) !== news.vmid) ||
            olds?.ostemplate !== news.ostemplate
          ) {
            return { action: "replace" } as const;
          }
        }),
        read: Effect.fn(function* ({ olds, output }) {
          const vmid = output?.vmid ?? olds?.vmid;
          if (!vmid) return undefined;
          return yield* readContainer(client, olds.node, vmid, output);
        }),
        reconcile: Effect.fn(function* ({ news, output }) {
          const vmid =
            output?.vmid ?? news.vmid ?? (yield* allocateVmid(client));

          // Observe — LXC create returns a task, and state writes can fail
          // after Proxmox succeeds, so always inspect live state first.
          const existing = yield* readContainer(
            client,
            news.node,
            vmid,
            output,
          );
          // Ensure / sync — create when absent; otherwise update mutable
          // container configuration through the LXC config endpoint.
          if (existing) {
            yield* request(() =>
              client.put(
                `/nodes/${news.node}/lxc/${vmid}/config`,
                containerToUpdateBody(news),
              ),
            );
          } else {
            const upid = yield* request<string>(() =>
              client.post(
                `/nodes/${news.node}/lxc`,
                containerToCreateBody({ ...news, vmid }),
              ),
            );
            yield* waitForTask(client, news.node, upid, news, options);
          }

          if (news.start) {
            const upid = yield* request<string>(() =>
              client.post(`/nodes/${news.node}/lxc/${vmid}/status/start`),
            );
            yield* waitForTask(client, news.node, upid, news, options);
          }

          return (
            (yield* readContainer(client, news.node, vmid, {
              node: news.node,
              vmid,
              name: news.hostname ?? news.name,
              type: "lxc",
            })) ?? {
              node: news.node,
              vmid,
              name: news.hostname ?? news.name,
              type: "lxc" as const,
            }
          );
        }),
        delete: Effect.fn(function* ({ olds, output }) {
          const existing = yield* readContainer(
            client,
            olds.node,
            output.vmid,
            output,
          );
          if (!existing) return;

          const upid = yield* request<string>(() =>
            client.delete(`/nodes/${olds.node}/lxc/${output.vmid}`),
          );
          yield* waitForTask(client, olds.node, upid, olds, options);
        }),
      });
    }),
  );

const containerToCreateBody = (props: ContainerProps & { vmid: number }) =>
  withoutUndefined({
    vmid: props.vmid,
    ostemplate: props.ostemplate,
    storage: props.storage,
    rootfs: props.rootfs,
    password: props.password,
    hostname: props.hostname ?? props.name,
    description: props.description,
    tags: tagsToString(props.tags),
    memory: props.memory,
    swap: props.swap,
    cores: props.cores,
    net0: props.net0,
    unprivileged: props.unprivileged,
    features: props.features,
    onboot: props.onboot,
    protection: props.protection,
    ...props.extra,
  });

const containerToUpdateBody = (props: ContainerProps) =>
  withoutUndefined({
    hostname: props.hostname ?? props.name,
    description: props.description,
    tags: tagsToString(props.tags),
    memory: props.memory,
    swap: props.swap,
    cores: props.cores,
    net0: props.net0,
    unprivileged: props.unprivileged,
    features: props.features,
    onboot: props.onboot,
    protection: props.protection,
    ...props.extra,
  });

const readContainer = (
  client: ProxmoxClient,
  node: string,
  vmid: number,
  fallback: ProxmoxGuestAttributes | undefined,
) =>
  request(async () => {
    try {
      const status = await client.get<{ name?: string; status?: string }>(
        `/nodes/${node}/lxc/${vmid}/status/current`,
      );
      return {
        node,
        vmid,
        name: status.name ?? fallback?.name,
        status: status.status,
        type: "lxc" as const,
      };
    } catch (error) {
      if (isProxmoxNotFound(error)) {
        return undefined;
      }
      throw error;
    }
  });

const allocateVmid = (client: ProxmoxClient) => request(() => client.nextId());

const waitForTask = (
  client: ProxmoxClient,
  node: string,
  upid: string,
  props: ProxmoxCommonProps,
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
