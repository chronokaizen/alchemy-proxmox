import { describe, expect } from "vitest";
import * as Test from "alchemy/Test/Vitest";
import * as Effect from "effect/Effect";
import { Proxmox } from "../src/index.js";

const makeFetch = () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const storages = new Map<string, Record<string, unknown>>();
  const pools = new Map<string, Record<string, unknown>>();

  const fetch = (async (url, init) => {
    const parsed = new URL(String(url));
    calls.push({ url: String(url), init });

    if (parsed.pathname.endsWith("/status")) {
      return json({ status: "stopped", exitstatus: "OK" });
    }

    if (parsed.pathname === "/api2/json/storage/test-media") {
      if (init?.method === "PUT") {
        storages.set("test-media", {
          ...storages.get("test-media"),
          ...Object.fromEntries(new URLSearchParams(String(init.body))),
        });
        return json(null);
      }
      if (init?.method === "DELETE") {
        storages.delete("test-media");
        return json(null);
      }
      const storage = storages.get("test-media");
      return storage ? json(storage) : notFound();
    }

    if (parsed.pathname === "/api2/json/storage" && init?.method === "POST") {
      const body = Object.fromEntries(new URLSearchParams(String(init.body)));
      storages.set(String(body.storage), body);
      return json({ storage: body.storage, type: body.type });
    }

    if (parsed.pathname === "/api2/json/nodes/pve/disks/zfs/testpool") {
      if (init?.method === "DELETE") {
        pools.delete("testpool");
        return json("UPID:zfs-delete");
      }
      const pool = pools.get("testpool");
      return pool ? json(pool) : notFound();
    }

    if (
      parsed.pathname === "/api2/json/nodes/pve/disks/zfs" &&
      init?.method === "POST"
    ) {
      const body = Object.fromEntries(new URLSearchParams(String(init.body)));
      pools.set(String(body.name), {
        name: body.name,
        state: "ONLINE",
        status: "pool is healthy",
      });
      return json("UPID:zfs-create");
    }

    return new Response("unexpected request", { status: 500 });
  }) as typeof globalThis.fetch;

  return { calls, fetch, pools, storages };
};

const json = (data: unknown) =>
  new Response(JSON.stringify({ data }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

const notFound = () => new Response("not found", { status: 404 });

describe("storage and zfs resources", () => {
  const api = makeFetch();
  const { test } = Test.make({
    providers: Proxmox.providers({
      baseUrl: "https://proxmox.example",
      fetch: api.fetch,
    }),
  });

  test.provider("creates and deletes Proxmox storage definitions", (stack) =>
    Effect.gen(function* () {
      api.calls.length = 0;
      api.storages.clear();

      const storage = yield* stack.deploy(
        Effect.gen(function* () {
          return yield* Proxmox.Storage("MediaStorage", {
            storage: "test-media",
            type: "dir",
            path: "/tank/media",
            content: ["iso", "vztmpl"],
            createBasePath: true,
            createSubdirs: true,
          });
        }),
      );

      expect(storage).toMatchObject({
        storage: "test-media",
        type: "dir",
        content: "iso,vztmpl",
        path: "/tank/media",
      });

      yield* stack.destroy();
      expect(
        api.calls.some(
          (call) =>
            call.init?.method === "DELETE" &&
            call.url.endsWith("/storage/test-media"),
        ),
      ).toBe(true);
    }),
  );

  test.provider("creates and deletes ZFS pools", (stack) =>
    Effect.gen(function* () {
      api.calls.length = 0;
      api.pools.clear();

      const pool = yield* stack.deploy(
        Effect.gen(function* () {
          return yield* Proxmox.ZfsPool("TestPool", {
            node: "pve",
            name: "testpool",
            devices: ["/dev/disk/by-id/test-a", "/dev/disk/by-id/test-b"],
            raidlevel: "mirror",
            compression: "zstd",
            cleanupConfig: true,
            cleanupDisks: true,
          });
        }),
      );

      expect(pool).toMatchObject({
        node: "pve",
        name: "testpool",
        state: "ONLINE",
      });

      const create = api.calls.find(
        (call) =>
          call.init?.method === "POST" &&
          call.url.endsWith("/nodes/pve/disks/zfs"),
      );
      expect(String(create?.init?.body)).toContain("raidlevel=mirror");

      yield* stack.destroy();
      const destroy = api.calls.find(
        (call) =>
          call.init?.method === "DELETE" &&
          call.url.endsWith("/nodes/pve/disks/zfs/testpool"),
      );
      expect(String(destroy?.init?.body)).toContain("cleanup-config=1");
      expect(String(destroy?.init?.body)).toContain("cleanup-disks=1");
    }),
  );
});
