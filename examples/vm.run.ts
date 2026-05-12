import * as Alchemy from "alchemy";
import * as Effect from "effect/Effect";
import { Proxmox } from "../dist/index.js";

export default Alchemy.Stack(
  "ProxmoxVmExample",
  {
    providers: Proxmox.providers({ successExitStatuses: ["OK", "WARNINGS: 1"] }),
    state: Alchemy.localState(),
  },
  Effect.gen(function* () {
    return yield* Proxmox.VirtualMachine("ExampleVm", {
      node: process.env.PROXMOX_EXAMPLE_NODE ?? "proxmox",
      name: process.env.PROXMOX_EXAMPLE_VM_NAME ?? "alchemy-vm",
      memory: 2048,
      cores: 2,
      net0: "virtio,bridge=vmbr0",
      scsi0: `${process.env.PROXMOX_EXAMPLE_VM_STORAGE ?? "vault-vm"}:32`,
      tags: ["alchemy", "vm"],
    });
  }),
);
