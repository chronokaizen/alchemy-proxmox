# alchemy-proxmox

[![npm](https://img.shields.io/npm/v/alchemy-proxmox?style=flat-square&label=alchemy-proxmox)](https://www.npmjs.com/package/alchemy-proxmox)
[![license](https://img.shields.io/badge/license-MIT-3f5a2a?style=flat-square)](./LICENSE)

Declarative Proxmox VE infrastructure for [Alchemy v2](https://v2.alchemy.run), built as typed [Effect](https://effect.website) resources.

[Alchemy docs](https://v2.alchemy.run) · [Custom providers](https://v2.alchemy.run/guides/custom-provider/) · [Proxmox API viewer](https://pve.proxmox.com/pve-docs/api-viewer/) · [Examples](./examples)

---

Create Proxmox guests and storage media from the same Alchemy stack:

```ts
import * as Alchemy from "alchemy";
import * as Output from "alchemy/Output";
import * as Effect from "effect/Effect";
import { Proxmox } from "alchemy-proxmox";

export default Alchemy.Stack(
  "Homelab",
  {
    providers: Proxmox.providers({ successExitStatuses: ["OK", "WARNINGS: 1"] }),
    state: Alchemy.localState(),
  },
  Effect.gen(function* () {
    const iso = yield* Proxmox.IsoImage("CachyOsIso", {
      node: "proxmox",
      storage: "local",
      filename: "cachyos-desktop-linux-260426.iso",
      url: "https://mirror.cachyos.org/ISO/desktop/260426/cachyos-desktop-linux-260426.iso",
      deleteOnDestroy: true,
      taskTimeoutMs: 900_000,
    });

    const vm = yield* Proxmox.VirtualMachine("CachyOsVm", {
      node: "proxmox",
      name: "alchemy-cachyos",
      memory: 4096,
      cores: 2,
      scsi0: "vault-vm:32",
      ide2: Output.interpolate`${iso.volid},media=cdrom`,
      boot: "order=ide2;scsi0",
      ostype: "l26",
      net0: "virtio,bridge=vmbr0",
      tags: ["alchemy", "vm", "cachyos"],
    });

    return { iso, vm };
  }),
);
```

One stack owns the storage media, VM config, dependency ordering, state, and destroy behavior.

---

## Resources

| Resource | Proxmox API area | Purpose |
| --- | --- | --- |
| `Proxmox.VirtualMachine` | `/nodes/{node}/qemu` | Create, update, adopt, and destroy QEMU VMs. |
| `Proxmox.Container` | `/nodes/{node}/lxc` | Create, update, adopt, and destroy LXC containers. |
| `Proxmox.IsoImage` | `/nodes/{node}/storage/{storage}` | Adopt, download, upload, and optionally delete ISO media. |
| `Proxmox.ContainerTemplate` | `/nodes/{node}/storage/{storage}` | Adopt, download, upload, and optionally delete LXC template archives. |
| `ProxmoxClient` | `/api2/json` | Low-level typed client for tests and advanced workflows. |

The provider follows the same Alchemy v2 shape as the built-in AWS and Cloudflare providers: resources are declared with `Resource(...)`, providers are wired through a `ProviderCollection`, and lifecycle behavior is implemented with `read`, `diff`, `reconcile`, and `delete`.

## Install

```sh
npm install alchemy-proxmox alchemy effect
```

## Credentials

Set `PROXMOX_URL` and either API token credentials or ticket credentials.

API tokens are recommended for automation:

```sh
export PROXMOX_URL=https://proxmox.example
export PROXMOX_API_TOKEN_ID='root@pam!alchemy'
export PROXMOX_API_TOKEN_SECRET='...'
```

Ticket auth is also supported:

```sh
export PROXMOX_URL=https://proxmox.example
export PROXMOX_USERNAME=root
export PROXMOX_PASSWORD='...'
export PROXMOX_REALM=pam
```

Do not commit credentials. Use shell env, CI secrets, or your preferred secret manager.

## Examples

This repository includes three focused example stacks:

```sh
npm run plan:example:lxc
npm run deploy:example:lxc
npm run destroy:example:lxc

npm run plan:example:vm
npm run deploy:example:vm
npm run destroy:example:vm

npm run plan:example:cachyos
npm run deploy:example:cachyos
npm run destroy:example:cachyos
```

`examples/lxc.run.ts` creates only an LXC container. `examples/vm.run.ts` creates a basic QEMU VM without install media. `examples/cachyos-iso-vm.run.ts` downloads a CachyOS ISO, creates a VM with that ISO attached as CD-ROM media, and removes both the VM and ISO on destroy.

Common example overrides:

```sh
export PROXMOX_EXAMPLE_NODE=proxmox
export PROXMOX_EXAMPLE_VM_STORAGE=vault-vm
export PROXMOX_EXAMPLE_LXC_STORAGE=vault-lxc
export PROXMOX_EXAMPLE_ISO_STORAGE=local
export PROXMOX_EXAMPLE_LXC_PASSWORD='change-me'
```

## Storage Media

Proxmox stores install media and container templates as storage content. Directory-backed storage such as `local` commonly supports `iso` and `vztmpl`, while VM disks and container root filesystems often live on storage such as `vault-vm` or `vault-lxc`.

`IsoImage` and `ContainerTemplate` support three flows:

- Existing file adoption: set `filename` and omit `url` and `path`.
- Server-side download: set `url`; Proxmox downloads the file through `/nodes/{node}/storage/{storage}/download-url`.
- Local upload: set `path`; Alchemy uploads the file through `/nodes/{node}/storage/{storage}/upload`.

For manually copied Proxmox files, reference the storage content name, not the host filesystem path. For example:

```ts
const iso = yield* Proxmox.IsoImage("UbuntuIso", {
  node: "proxmox",
  storage: "local",
  filename: "ubuntu-24.04.2-live-server-amd64.iso",
});
```

That file resolves to the Proxmox volume ID `local:iso/ubuntu-24.04.2-live-server-amd64.iso`.

Destroy is conservative by default: storage media is left in place unless `deleteOnDestroy: true` is set. The CachyOS example opts into deletion so a demo deploy/destroy cycle cleans up after itself.

## Testing

Run local checks:

```sh
npm run check
npm test
```

Live Proxmox E2E tests are opt-in because they create and destroy real resources:

```sh
export RUN_PROXMOX_E2E=1
export PROXMOX_E2E_NODE=proxmox
export PROXMOX_E2E_VM_STORAGE=vault-vm
export PROXMOX_E2E_LXC_STORAGE=vault-lxc
export PROXMOX_E2E_LXC_TEMPLATE='local:vztmpl/debian-12-standard_12.12-1_amd64.tar.zst'
npm run test:e2e
```

The CachyOS ISO E2E is separately gated because it downloads a full ISO and creates a VM:

```sh
export RUN_PROXMOX_CACHYOS_ISO_E2E=1
export PROXMOX_E2E_ISO_STORAGE=local
export PROXMOX_E2E_CACHYOS_ISO_URL='https://mirror.cachyos.org/ISO/desktop/260426/cachyos-desktop-linux-260426.iso'
npm run test:e2e -- -t 'download CachyOS ISO'
```

The E2E suite uses `alchemy/Test/Vitest` and `test.provider(...)`, matching the Alchemy provider testing style. Normal `npm test` keeps live tests skipped unless the gate env vars are set.

## Provider Notes

- Proxmox VMIDs are global across QEMU and LXC. The provider retries auto-allocated VMIDs when concurrent creates collide.
- `/cluster/resources` uses broad filters such as `type=vm`; QEMU and LXC-specific operations use node endpoints like `/nodes/{node}/qemu` and `/nodes/{node}/lxc`.
- Proxmox storage upload supports `iso`, `vztmpl`, and `import` content. This package exposes ISO and container template resources today.
- Task waiting accepts `OK` by default. Some Proxmox operations can return warning statuses, so examples use `successExitStatuses: ["OK", "WARNINGS: 1"]`.

## Publishing

The package is configured for public npm publishing:

```sh
npm run check
npm test
npm run build
npm publish --dry-run
```

`prepublishOnly` runs type checking, tests, and the build before `npm publish`.

The upstream Alchemy Proxmox provider issue was closed as not planned, with maintainers open to linking a community provider once published: https://github.com/alchemy-run/alchemy/issues/1338

## Status

`alchemy` v2 is still in beta. Treat this provider as production-minded but evolving: pin versions, run a plan before deploy, and keep live E2E tests gated behind explicit credentials.

## License

MIT
