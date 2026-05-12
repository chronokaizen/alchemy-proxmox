import * as Alchemy from "alchemy";
import * as Effect from "effect/Effect";
import { Proxmox } from "../dist/index.js";

export default Alchemy.Stack(
  "ProxmoxLxcExample",
  {
    providers: Proxmox.providers({ successExitStatuses: ["OK", "WARNINGS: 1"] }),
    state: Alchemy.localState(),
  },
  Effect.gen(function* () {
    return yield* Proxmox.Container("ExampleContainer", {
      node: process.env.PROXMOX_EXAMPLE_NODE ?? "proxmox",
      hostname: process.env.PROXMOX_EXAMPLE_LXC_HOSTNAME ?? "alchemy-lxc",
      ostemplate:
        process.env.PROXMOX_EXAMPLE_LXC_TEMPLATE ??
        "local:vztmpl/debian-12-standard_12.12-1_amd64.tar.zst",
      storage: process.env.PROXMOX_EXAMPLE_LXC_STORAGE ?? "vault-lxc",
      rootfs: `${process.env.PROXMOX_EXAMPLE_LXC_STORAGE ?? "vault-lxc"}:8`,
      password:
        process.env.PROXMOX_EXAMPLE_LXC_PASSWORD ?? "alchemy-demo-change-me",
      memory: 512,
      cores: 1,
      net0: "name=eth0,bridge=vmbr0,ip=dhcp",
      unprivileged: true,
      tags: ["alchemy", "lxc"],
    });
  }),
);
