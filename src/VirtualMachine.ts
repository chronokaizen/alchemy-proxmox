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

export interface VirtualMachineProps extends ProxmoxCommonProps {
  readonly memory: number;
  readonly cores?: number;
  readonly sockets?: number;
  readonly ostype?: string;
  readonly agent?: boolean | number;
  readonly boot?: string;
  readonly scsi0?: string;
  readonly ide2?: string;
  readonly net0?: string;
  readonly onboot?: boolean;
  readonly protection?: boolean;
}

export interface VirtualMachine
  extends Resource<
    "Proxmox.VirtualMachine",
    VirtualMachineProps,
    ProxmoxGuestAttributes & {
      readonly type: "qemu";
    },
    never,
    Providers
  > {}

export const VirtualMachine = Resource<VirtualMachine>(
  "Proxmox.VirtualMachine",
);

export const VirtualMachineProvider = (options: ProxmoxProviderOptions = {}) =>
  Provider.effect(
    VirtualMachine,
    Effect.gen(function* () {
      const client = createProxmoxClient(options);

      return VirtualMachine.Provider.of({
        stables: ["node", "vmid", "type"],
        diff: Effect.fn(function* ({ olds, news, output }) {
          if (!isResolved(news)) return;
          if (
            (output?.node ?? olds?.node) !== news.node ||
            (news.vmid !== undefined &&
              (output?.vmid ?? olds?.vmid) !== news.vmid)
          ) {
            return { action: "replace" } as const;
          }
        }),
        read: Effect.fn(function* ({ olds, output }) {
          const vmid =
            output?.vmid ??
            olds?.vmid ??
            (yield* findGuestVmid(client, "qemu", olds.node, olds.name));
          if (!vmid) return undefined;
          return yield* readVm(client, olds.node, vmid, output);
        }),
        reconcile: Effect.fn(function* ({ news, output }) {
          let vmid =
            output?.vmid ?? news.vmid ?? (yield* allocateVmid(client));

          // Observe — Proxmox may already have the VM if state persistence
          // failed after a prior create, so fetch live state before mutating.
          const existing = yield* readVm(client, news.node, vmid, output);
          const body = vmToApiBody({ ...news, vmid });

          // Ensure / sync — create missing VMs; otherwise update mutable
          // config through the QEMU config endpoint.
          if (existing) {
            yield* request(() =>
              client.put(`/nodes/${news.node}/qemu/${vmid}/config`, body),
            );
          } else {
            const created = yield* createVm(client, news, vmid);
            vmid = created.vmid;
            yield* waitForTask(client, news.node, created.upid, news, options);
          }

          if (news.start) {
            const upid = yield* request<string>(() =>
              client.post(`/nodes/${news.node}/qemu/${vmid}/status/start`),
            );
            yield* waitForTask(client, news.node, upid, news, options);
          }

          return (
            (yield* readVm(client, news.node, vmid, {
              node: news.node,
              vmid,
              name: news.name,
              type: "qemu",
            })) ?? {
              node: news.node,
              vmid,
              name: news.name,
              type: "qemu" as const,
            }
          );
        }),
        delete: Effect.fn(function* ({ olds, output }) {
          const existing = yield* readVm(client, olds.node, output.vmid, output);
          if (!existing) return;

          const upid = yield* request<string>(() =>
            client.delete(`/nodes/${olds.node}/qemu/${output.vmid}`),
          );
          yield* waitForTask(client, olds.node, upid, olds, options);
        }),
      });
    }),
  );

const vmToApiBody = (props: VirtualMachineProps & { vmid: number }) =>
  withoutUndefined({
    vmid: props.vmid,
    name: props.name,
    description: props.description,
    tags: tagsToString(props.tags),
    memory: props.memory,
    cores: props.cores,
    sockets: props.sockets,
    ostype: props.ostype,
    agent:
      typeof props.agent === "boolean"
        ? props.agent
          ? 1
          : 0
        : props.agent,
    boot: props.boot,
    scsi0: props.scsi0,
    ide2: props.ide2,
    net0: props.net0,
    onboot: props.onboot,
    protection: props.protection,
    ...props.extra,
  });

const readVm = (
  client: ProxmoxClient,
  node: string,
  vmid: number,
  fallback: ProxmoxGuestAttributes | undefined,
) =>
  request(async () => {
    try {
      const status = await client.get<{ name?: string; status?: string }>(
        `/nodes/${node}/qemu/${vmid}/status/current`,
      );
      return {
        node,
        vmid,
        name: status.name ?? fallback?.name,
        status: status.status,
        type: "qemu" as const,
      };
    } catch (error) {
      if (isProxmoxNotFound(error)) {
        return undefined;
      }
      throw error;
    }
  });

const allocateVmid = (client: ProxmoxClient) => request(() => client.nextId());

const createVm = (
  client: ProxmoxClient,
  props: VirtualMachineProps,
  vmid: number,
): Effect.Effect<{ readonly upid: string; readonly vmid: number }, unknown> =>
  request<string>(() =>
    client.post(`/nodes/${props.node}/qemu`, vmToApiBody({ ...props, vmid })),
  ).pipe(
    Effect.map((upid) => ({ upid, vmid })),
  ).pipe(
    Effect.catchIf(
      (error) =>
        props.vmid === undefined &&
        error instanceof Error &&
        /(?:VM|CT) \d+ already exists/i.test(error.message),
      () =>
        Effect.gen(function* () {
          const retryVmid = yield* allocateVmid(client);
          return yield* createVm(
            client,
            props,
            retryVmid === vmid ? vmid + 1 : retryVmid,
          );
        }),
    ),
  );

const findGuestVmid = (
  client: ProxmoxClient,
  type: "qemu" | "lxc",
  node: string,
  name: string | undefined,
) =>
  name
    ? request(async () => {
        const resources =
          type === "qemu" ? await client.qemu(node) : await client.lxc(node);
        return resources.find(
          (resource) => resource.name === name,
        )?.vmid;
      })
    : Effect.succeed(undefined);

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
