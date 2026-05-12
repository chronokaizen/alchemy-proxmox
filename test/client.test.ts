import { describe, expect, it } from "vitest";
import { ProxmoxClient, ProxmoxApiError } from "../src/client.js";

const json = (data: unknown, init?: ResponseInit) =>
  new Response(JSON.stringify({ data }), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });

describe("ProxmoxClient", () => {
  it("authenticates with ticket credentials and sends CSRF for mutations", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const client = new ProxmoxClient({
      baseUrl: "https://proxmox.example",
      credentials: { username: "root", password: "secret" },
      fetch: async (url, init) => {
        calls.push({ url: String(url), init });
        if (String(url).endsWith("/api2/json/access/ticket")) {
          expect(String(init?.body)).toContain("username=root%40pam");
          return json({
            ticket: "ticket-value",
            CSRFPreventionToken: "csrf-value",
          });
        }
        return json("UPID:test");
      },
    });

    await expect(client.post("/nodes/pve/qemu", { vmid: 101 })).resolves.toBe(
      "UPID:test",
    );

    const mutation = calls.at(-1);
    const headers = new Headers(mutation?.init?.headers);
    expect(headers.get("cookie")).toBe("PVEAuthCookie=ticket-value");
    expect(headers.get("csrfpreventiontoken")).toBe("csrf-value");
    expect(String(mutation?.init?.body)).toBe("vmid=101");
  });

  it("uses API token credentials without requesting a ticket", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const client = new ProxmoxClient({
      baseUrl: "https://proxmox.example/",
      credentials: { tokenId: "root@pam!alchemy", secret: "token-secret" },
      fetch: async (url, init) => {
        calls.push({ url: String(url), init });
        return json([{ vmid: 100, type: "qemu", node: "pve" }]);
      },
    });

    await expect(client.resources("vm")).resolves.toEqual([
      { vmid: 100, type: "qemu", node: "pve" },
    ]);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(
      "https://proxmox.example/api2/json/cluster/resources?type=vm",
    );
    expect(new Headers(calls[0]?.init?.headers).get("authorization")).toBe(
      "PVEAPIToken=root@pam!alchemy=token-secret",
    );
  });

  it("lists qemu and lxc guests through node endpoints", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const client = new ProxmoxClient({
      baseUrl: "https://proxmox.example",
      fetch: async (url, init) => {
        calls.push({ url: String(url), init });
        return json([]);
      },
    });

    await expect(client.qemu("pve/node")).resolves.toEqual([]);
    await expect(client.lxc("pve/node")).resolves.toEqual([]);

    expect(calls.map((call) => call.url)).toEqual([
      "https://proxmox.example/api2/json/nodes/pve%2Fnode/qemu",
      "https://proxmox.example/api2/json/nodes/pve%2Fnode/lxc",
    ]);
  });

  it("raises structured API errors", async () => {
    const client = new ProxmoxClient({
      baseUrl: "https://proxmox.example",
      fetch: async () => new Response("nope", { status: 500 }),
    });

    await expect(client.get("/version")).rejects.toMatchObject({
      name: "ProxmoxApiError",
      status: 500,
      responseText: "nope",
    } satisfies Partial<ProxmoxApiError>);
  });
});
