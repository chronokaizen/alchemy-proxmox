import * as Alchemy from "alchemy";
import * as Output from "alchemy/Output";
import * as Effect from "effect/Effect";
import { Proxmox } from "../dist/index.js";

const cachyOsUrl =
  process.env.PROXMOX_EXAMPLE_CACHYOS_ISO_URL ??
  "https://mirror.cachyos.org/ISO/desktop/260426/cachyos-desktop-linux-260426.iso";
const cachyOsFilename =
  process.env.PROXMOX_EXAMPLE_CACHYOS_ISO_FILENAME ??
  "cachyos-desktop-linux-260426.iso";

export default Alchemy.Stack(
  "ProxmoxCachyOsIsoVmExample",
  {
    providers: Proxmox.providers({ successExitStatuses: ["OK", "WARNINGS: 1"] }),
    state: Alchemy.localState(),
  },
  Effect.gen(function* () {
    const iso = yield* Proxmox.IsoImage("CachyOsIso", {
      node: process.env.PROXMOX_EXAMPLE_NODE ?? "proxmox",
      storage: process.env.PROXMOX_EXAMPLE_ISO_STORAGE ?? "local",
      filename: cachyOsFilename,
      url: cachyOsUrl,
      deleteOnDestroy: true,
      taskTimeoutMs: 900_000,
    });

    const vm = yield* Proxmox.VirtualMachine("CachyOsVm", {
      node: process.env.PROXMOX_EXAMPLE_NODE ?? "proxmox",
      name: process.env.PROXMOX_EXAMPLE_CACHYOS_VM_NAME ?? "alchemy-cachyos",
      memory: 4096,
      cores: 2,
      net0: "virtio,bridge=vmbr0",
      scsi0: `${process.env.PROXMOX_EXAMPLE_VM_STORAGE ?? "vault-vm"}:32`,
      ide2: Output.interpolate`${iso.volid},media=cdrom`,
      boot: "order=ide2;scsi0",
      ostype: "l26",
      tags: ["alchemy", "vm", "cachyos"],
    });

    return { iso, vm };
  }),
);
