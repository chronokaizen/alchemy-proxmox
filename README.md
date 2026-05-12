# alchemy-proxmox

Alchemy v2 provider for declarative Proxmox VE resources.

This package currently exposes:

- `Proxmox.VirtualMachine` for QEMU VMs
- `Proxmox.Container` for LXC containers
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

The LXC E2E test generates an ephemeral root password unless `PROXMOX_E2E_LXC_PASSWORD` is set.

## Publishing

The package includes `prepublishOnly`, which runs type checking, tests, and the build before `npm publish`.

The upstream Alchemy issue for a Proxmox provider was closed as not planned, with maintainers open to linking an unofficial/community provider from the docs once published: https://github.com/alchemy-run/alchemy/issues/1338
