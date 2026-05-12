import { State } from "alchemy/State";
import * as Test from "alchemy/Test/Vitest";
import { expect } from "@effect/vitest";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import { MinimumLogLevel } from "effect/References";
import * as Schedule from "effect/Schedule";
import { Proxmox, createProxmoxClient } from "../../src/index.js";

const hasLiveCredentials =
  process.env.RUN_PROXMOX_E2E === "1" &&
  !!process.env.PROXMOX_URL &&
  (!!process.env.PROXMOX_API_TOKEN_ID ||
    (!!process.env.PROXMOX_USERNAME && !!process.env.PROXMOX_PASSWORD));

const { test } = Test.make({
  providers: Proxmox.providers({ successExitStatuses: ["OK", "WARNINGS: 1"] }),
});

const logLevel = Effect.provideService(
  MinimumLogLevel,
  process.env.DEBUG ? "Debug" : "Info",
);

test.skipIf(!hasLiveCredentials)(
  "lists Proxmox resources",
  Effect.promise(async () => {
    const client = createProxmoxClient();
    const resources = await client.resources();
    expect(Array.isArray(resources)).toBe(true);
  }),
);

test.provider.skipIf(!hasLiveCredentials)(
  "create, update, delete LXC container",
  (stack) =>
    Effect.gen(function* () {
      const node = process.env.PROXMOX_E2E_NODE ?? "proxmox";
      const storage = process.env.PROXMOX_E2E_LXC_STORAGE ?? "vault-lxc";
      const template = process.env.PROXMOX_E2E_LXC_TEMPLATE;
      const password =
        process.env.PROXMOX_E2E_LXC_PASSWORD ?? crypto.randomUUID();

      if (!template) {
        return yield* Effect.fail(
          new Error("PROXMOX_E2E_LXC_TEMPLATE is required for LXC E2E"),
        );
      }

      yield* stack.destroy();

      const name = `alchemy-lxc-${crypto.randomUUID().slice(0, 8)}`;
      const container = yield* stack.deploy(
        Effect.gen(function* () {
          return yield* Proxmox.Container("TestContainer", {
            node,
            hostname: name,
            ostemplate: template,
            storage,
            rootfs: `${storage}:1`,
            password,
            memory: 256,
            cores: 1,
            tags: ["alchemy", "e2e"],
          });
        }),
      );

      expect(container.vmid).toBeGreaterThan(0);
      expect(container.name).toEqual(name);

      const updated = yield* stack.deploy(
        Effect.gen(function* () {
          return yield* Proxmox.Container("TestContainer", {
            node,
            hostname: name,
            ostemplate: template,
            storage,
            rootfs: `${storage}:1`,
            password,
            memory: 512,
            cores: 1,
            tags: ["alchemy", "e2e"],
          });
        }),
      );

      expect(updated.vmid).toEqual(container.vmid);

      yield* stack.destroy();
      yield* assertLxcDeleted(node, container.vmid);
    }).pipe(logLevel),
  { timeout: 180_000 },
);

test.provider.skipIf(!hasLiveCredentials)(
  "create, update, delete QEMU VM",
  (stack) =>
    Effect.gen(function* () {
      const node = process.env.PROXMOX_E2E_NODE ?? "proxmox";
      const storage = process.env.PROXMOX_E2E_VM_STORAGE ?? "vault-vm";

      yield* stack.destroy();

      const name = `alchemy-vm-${crypto.randomUUID().slice(0, 8)}`;
      const vm = yield* stack.deploy(
        Effect.gen(function* () {
          return yield* Proxmox.VirtualMachine("TestVm", {
            node,
            name,
            memory: 512,
            cores: 1,
            scsi0: `${storage}:1`,
            net0: "virtio,bridge=vmbr0",
            tags: ["alchemy", "e2e"],
          });
        }),
      );

      expect(vm.vmid).toBeGreaterThan(0);
      expect(vm.name).toEqual(name);

      const updated = yield* stack.deploy(
        Effect.gen(function* () {
          return yield* Proxmox.VirtualMachine("TestVm", {
            node,
            name,
            memory: 768,
            cores: 1,
            scsi0: `${storage}:1`,
            net0: "virtio,bridge=vmbr0",
            tags: ["alchemy", "e2e"],
          });
        }),
      );

      expect(updated.vmid).toEqual(vm.vmid);

      yield* stack.destroy();
      yield* assertVmDeleted(node, vm.vmid);
    }).pipe(logLevel),
  { timeout: 180_000 },
);

test.provider.skipIf(!hasLiveCredentials)(
  "existing LXC matching state can be re-adopted",
  (stack) =>
    Effect.gen(function* () {
      const node = process.env.PROXMOX_E2E_NODE ?? "proxmox";
      const storage = process.env.PROXMOX_E2E_LXC_STORAGE ?? "vault-lxc";
      const template = process.env.PROXMOX_E2E_LXC_TEMPLATE;
      const password =
        process.env.PROXMOX_E2E_LXC_PASSWORD ?? crypto.randomUUID();

      if (!template) {
        return yield* Effect.fail(
          new Error("PROXMOX_E2E_LXC_TEMPLATE is required for adoption E2E"),
        );
      }

      yield* stack.destroy();

      const name = `alchemy-adopt-${crypto.randomUUID().slice(0, 8)}`;
      const initial = yield* stack.deploy(
        Effect.gen(function* () {
          return yield* Proxmox.Container("AdoptableContainer", {
            node,
            hostname: name,
            ostemplate: template,
            storage,
            rootfs: `${storage}:1`,
            password,
            memory: 256,
            cores: 1,
          });
        }),
      );

      yield* Effect.gen(function* () {
        const state = yield* State;
        yield* state.delete({
          stack: stack.name,
          stage: "test",
          fqn: "AdoptableContainer",
        });
      }).pipe(Effect.provide(stack.state));

      const adopted = yield* stack.deploy(
        Effect.gen(function* () {
          return yield* Proxmox.Container("AdoptableContainer", {
            node,
            vmid: initial.vmid,
            hostname: name,
            ostemplate: template,
            storage,
            rootfs: `${storage}:1`,
            password,
            memory: 256,
            cores: 1,
          });
        }),
      );

      expect(adopted.vmid).toEqual(initial.vmid);

      yield* stack.destroy();
      yield* assertLxcDeleted(node, initial.vmid);
    }).pipe(logLevel),
  { timeout: 180_000 },
);

class VmStillExists extends Data.TaggedError("VmStillExists") {}

class LxcStillExists extends Data.TaggedError("LxcStillExists") {}

const assertVmDeleted = Effect.fn(function* (node: string, vmid: number) {
  const client = createProxmoxClient();
  yield* Effect.tryPromise({
    try: () => client.get(`/nodes/${node}/qemu/${vmid}/status/current`),
    catch: (error) => error,
  }).pipe(
    Effect.flatMap(() => Effect.fail(new VmStillExists())),
    Effect.retry({
      while: (e): e is VmStillExists => e instanceof VmStillExists,
      schedule: Schedule.exponential(100),
    }),
    Effect.catch(() => Effect.void),
  );
});

const assertLxcDeleted = Effect.fn(function* (node: string, vmid: number) {
  const client = createProxmoxClient();
  yield* Effect.tryPromise({
    try: () => client.get(`/nodes/${node}/lxc/${vmid}/status/current`),
    catch: (error) => error,
  }).pipe(
    Effect.flatMap(() => Effect.fail(new LxcStillExists())),
    Effect.retry({
      while: (e): e is LxcStillExists => e instanceof LxcStillExists,
      schedule: Schedule.exponential(100),
    }),
    Effect.catch(() => Effect.void),
  );
});
