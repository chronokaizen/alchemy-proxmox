import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect } from "vitest";
import * as Test from "alchemy/Test/Vitest";
import * as Effect from "effect/Effect";
import { Proxmox } from "../src/index.js";

const makeFetch = () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const files = new Map<string, { format: string; size: number }>();

  const fetch = (async (url, init) => {
    const parsed = new URL(String(url));
    calls.push({ url: String(url), init });

    if (parsed.pathname.endsWith("/status")) {
      return json({ status: "stopped", exitstatus: "OK" });
    }

    if (parsed.pathname.endsWith("/content")) {
      const content = parsed.searchParams.get("content");
      return json(
        Array.from(files.entries())
          .filter(([volid]) => !content || volid.includes(`:${content}/`))
          .map(([volid, file]) => ({
            volid,
            format: file.format,
            size: file.size,
          })),
      );
    }

    if (parsed.pathname.endsWith("/download-url") && init?.method === "POST") {
      const params = new URLSearchParams(String(init.body));
      const content = params.get("content") ?? "iso";
      const filename = params.get("filename") ?? "downloaded";
      const storage = storageFromPath(parsed.pathname);
      files.set(`${storage}:${content}/${filename}`, {
        format: content === "iso" ? "iso" : "tgz",
        size: 2048,
      });
      return json("UPID:download");
    }

    if (parsed.pathname.endsWith("/upload") && init?.method === "POST") {
      const form = init.body as FormData;
      const content = String(form.get("content"));
      const file = form.get("filename") as File;
      const storage = storageFromPath(parsed.pathname);
      files.set(`${storage}:${content}/${file.name}`, {
        format: content === "iso" ? "iso" : "tgz",
        size: file.size,
      });
      return json("UPID:upload");
    }

    if (parsed.pathname.includes("/content/") && init?.method === "DELETE") {
      const encodedVolid = parsed.pathname.split("/content/")[1]!;
      files.delete(decodeURIComponent(encodedVolid));
      return json("UPID:delete");
    }

    return new Response("unexpected request", { status: 500 });
  }) as typeof globalThis.fetch;

  return { calls, fetch, files };
};

const json = (data: unknown) =>
  new Response(JSON.stringify({ data }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

const storageFromPath = (path: string) => {
  const match = path.match(/\/storage\/([^/]+)/);
  if (!match) throw new Error(`Could not find storage in ${path}`);
  return decodeURIComponent(match[1]!);
};

describe("storage file resources", () => {
  const api = makeFetch();
  const { test } = Test.make({
    providers: Proxmox.providers({
      baseUrl: "https://proxmox.example",
      fetch: api.fetch,
    }),
  });

  test.provider("downloads ISO images from URL", (stack) =>
    Effect.gen(function* () {
      api.calls.length = 0;
      api.files.clear();

      const image = yield* stack.deploy(
        Effect.gen(function* () {
          return yield* Proxmox.IsoImage("UbuntuIso", {
            node: "pve",
            storage: "local",
            filename: "ubuntu-24.04.iso",
            url: "https://releases.ubuntu.com/24.04/ubuntu-24.04.iso",
          });
        }),
      );

      expect(image.volid).toBe("local:iso/ubuntu-24.04.iso");
      expect(api.calls.some((call) => call.url.endsWith("/download-url"))).toBe(
        true,
      );

      yield* stack.destroy();
      expect(
        api.calls.some((call) => call.init?.method === "DELETE"),
      ).toBe(false);
    }),
  );

  test.provider("uploads and deletes managed container templates", (stack) =>
    Effect.gen(function* () {
      api.calls.length = 0;
      api.files.clear();
      const dir = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "pve-")));
      const templatePath = join(dir, "debian-12.tar.zst");
      yield* Effect.promise(() => writeFile(templatePath, "template"));

      const template = yield* stack.deploy(
        Effect.gen(function* () {
          return yield* Proxmox.ContainerTemplate("DebianTemplate", {
            node: "pve",
            storage: "local",
            path: templatePath,
            deleteOnDestroy: true,
          });
        }),
      );

      expect(template.volid).toBe("local:vztmpl/debian-12.tar.zst");
      expect(api.calls.some((call) => call.url.endsWith("/upload"))).toBe(true);

      yield* stack.destroy();
      expect(
        api.calls.some(
          (call) =>
            call.init?.method === "DELETE" &&
            call.url.includes("local%3Avztmpl%2Fdebian-12.tar.zst"),
        ),
      ).toBe(true);
    }),
  );
});
