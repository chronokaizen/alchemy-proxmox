import * as Alchemy from "alchemy";
import * as Effect from "effect/Effect";
import { Proxmox } from "../src/index.js";

export default Alchemy.Stack(
  "ProxmoxExample",
  {
    providers: Proxmox.providers(),
    state: Alchemy.localState(),
  },
  Effect.gen(function* () {
    const vm = yield* Proxmox.VirtualMachine("ExampleVm", {
      node: "proxmox",
      name: "alchemy-vm",
      memory: 2048,
      cores: 2,
      net0: "virtio,bridge=vmbr0",
      scsi0: "vault-vm:32",
      tags: ["alchemy", "vm"],
    });

    const container = yield* Proxmox.Container("ExampleContainer", {
      node: "proxmox",
      hostname: "alchemy-lxc",
      ostemplate: "local:vztmpl/debian-12-standard_12.7-1_amd64.tar.zst",
      storage: "vault-lxc",
      rootfs: "vault-lxc:8",
      memory: 512,
      cores: 1,
      net0: "name=eth0,bridge=vmbr0,ip=dhcp",
      unprivileged: true,
      tags: ["alchemy", "lxc"],
    });

    return { vm, container };
  }),
);
