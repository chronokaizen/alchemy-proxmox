# alchemy-proxmox

Alchemy v2 provider for declarative Proxmox VE resources.

This package currently exposes:

- `Proxmox.VirtualMachine` for QEMU VMs
- `Proxmox.Container` for LXC containers
- `Proxmox.IsoImage` for ISO files on Proxmox storage
- `Proxmox.ContainerTemplate` for LXC template archives on Proxmox storage
- `Proxmox.Provider()` as the combined provider layer
- `Proxmox.providers()` for the Alchemy v2 provider collection layer
- `ProxmoxClient` for low-level Proxmox API access

The provider follows the Alchemy v2 resource/provider style used by the built-in AWS and Cloudflare providers: resource constructors are created with `Resource(...)`, lifecycle is implemented with provider layers using `read`, `diff`, `reconcile`, and `delete`, and E2E coverage uses `alchemy/Test/Vitest` with `test.provider(...)`.

## Install

```bash
npm install alchemy-proxmox alchemy effect
```

## Credentials

Use an API token where possible:

```bash
export PROXMOX_URL=https://proxmox.example
export PROXMOX_API_TOKEN_ID='root@pam!alchemy'
export PROXMOX_API_TOKEN_SECRET='...'
```

Ticket auth is also supported:

```bash
export PROXMOX_URL=https://proxmox.example
export PROXMOX_USERNAME=root
export PROXMOX_PASSWORD='...'
export PROXMOX_REALM=pam
```

## Example

```ts
import * as Alchemy from "alchemy";
import * as Output from "alchemy/Output";
import * as Effect from "effect/Effect";
import { Proxmox } from "alchemy-proxmox";

export default Alchemy.Stack(
  "Homelab",
  {
    providers: Proxmox.providers(),
    state: Alchemy.localState(),
  },
  Effect.gen(function* () {
    const vm = yield* Proxmox.VirtualMachine("WebVm", {
      node: "proxmox",
      name: "web-01",
      memory: 2048,
      cores: 2,
      scsi0: "local-lvm:32",
      net0: "virtio,bridge=vmbr0",
      tags: ["alchemy", "vm"],
    });

    const container = yield* Proxmox.Container("WorkerLxc", {
      node: "proxmox",
      hostname: "worker-01",
      ostemplate: "local:vztmpl/debian-12-standard_12.7-1_amd64.tar.zst",
      storage: "local-lvm",
      rootfs: "local-lvm:8",
      memory: 512,
      net0: "name=eth0,bridge=vmbr0,ip=dhcp",
      unprivileged: true,
      tags: ["alchemy", "lxc"],
    });

    return { vm, container };
  }),
);
```

## Storage Media

Proxmox stores install media and container templates as storage content. Directory-backed storage such as `local` commonly supports `iso` and `vztmpl` content, while VM disks and container root filesystems often live on separate storage such as `vault-vm` or `vault-lxc`.

The provider exposes these as declarative resources:

```ts
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
});
```

`IsoImage` and `ContainerTemplate` support two creation modes:

- `url`: asks Proxmox to download the file with `/nodes/{node}/storage/{storage}/download-url`.
- `path`: uploads a local file from the machine running Alchemy with `/nodes/{node}/storage/{storage}/upload`.

If the file already exists on Proxmox storage, omit `url` and `path` and set `filename`; the resource adopts the existing storage content by `storage + filename`. For manually copied Proxmox files, use the storage filename, not the host filesystem path. For example, an ISO placed in the local ISO directory is referenced as `local:iso/<filename>.iso`, and an LXC template as `local:vztmpl/<template>.tar.zst`.

Destroy is conservative by default: storage media is left in place unless `deleteOnDestroy: true` is set on the media resource.
The CachyOS example sets `deleteOnDestroy: true`, so destroying that example removes both the VM and the downloaded ISO.

Example stacks:

```bash
npm run plan:example:lxc
npm run plan:example:vm
npm run plan:example:cachyos
```

## Tests

```bash
npm run check
npm test
```

Live Proxmox E2E tests are opt-in:

```bash
export RUN_PROXMOX_E2E=1
export PROXMOX_E2E_NODE=proxmox
export PROXMOX_E2E_VM_STORAGE=vault-vm
export PROXMOX_E2E_LXC_STORAGE=vault-lxc
export PROXMOX_E2E_LXC_TEMPLATE='local:vztmpl/debian-12-standard_12.7-1_amd64.tar.zst'
npm run test:e2e
```

The CachyOS ISO E2E test is separately gated because it downloads a real ISO and creates a real VM:

```bash
export RUN_PROXMOX_CACHYOS_ISO_E2E=1
export PROXMOX_E2E_ISO_STORAGE=local
export PROXMOX_E2E_CACHYOS_ISO_URL='https://mirror.cachyos.org/ISO/desktop/260426/cachyos-desktop-linux-260426.iso'
npm run test:e2e -- -t 'download CachyOS ISO'
```

The LXC E2E test generates an ephemeral root password unless `PROXMOX_E2E_LXC_PASSWORD` is set.

For the example deploy, set `PROXMOX_EXAMPLE_LXC_PASSWORD` to control the demo LXC root password. If omitted, the example uses `alchemy-demo-change-me`.

## Publishing

The package includes `prepublishOnly`, which runs type checking, tests, and the build before `npm publish`.

The upstream Alchemy issue for a Proxmox provider was closed as not planned, with maintainers open to linking an unofficial/community provider from the docs once published: https://github.com/alchemy-run/alchemy/issues/1338
