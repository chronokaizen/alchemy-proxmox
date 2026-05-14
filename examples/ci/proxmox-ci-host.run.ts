import * as Alchemy from "alchemy";
import * as Output from "alchemy/Output";
import * as Effect from "effect/Effect";
import { Proxmox } from "../../dist/index.js";

const node = process.env.PROXMOX_CI_NODE ?? "proxmox";
const isoStorage = process.env.PROXMOX_CI_ISO_STORAGE ?? "local";
const vmStorage = process.env.PROXMOX_CI_VM_STORAGE ?? "vault-vm";
const isoPath =
  process.env.PROXMOX_CI_AUTO_ISO_PATH ??
  ".generated/proxmox-ci/proxmox-ve-auto.iso";
const isoFilename =
  process.env.PROXMOX_CI_AUTO_ISO_FILENAME ?? "alchemy-proxmox-ci-auto.iso";
const vmName = process.env.PROXMOX_CI_VM_NAME ?? "alchemy-proxmox-ci";

export default Alchemy.Stack(
  "ProxmoxCiHost",
  {
    providers: Proxmox.providers({
      successExitStatuses: ["OK", "WARNINGS: 1"],
      waitTimeoutMs: 1_200_000,
    }),
    state: Alchemy.localState(),
  },
  Effect.gen(function* () {
    const iso = yield* Proxmox.IsoImage("ProxmoxCiInstallerIso", {
      node,
      storage: isoStorage,
      filename: isoFilename,
      path: isoPath,
      deleteOnDestroy: true,
      taskTimeoutMs: 1_200_000,
    });

    const vm = yield* Proxmox.VirtualMachine("ProxmoxCiHostVm", {
      node,
      name: vmName,
      memory: Number(process.env.PROXMOX_CI_VM_MEMORY ?? 8192),
      cores: Number(process.env.PROXMOX_CI_VM_CORES ?? 4),
      sockets: 1,
      ostype: "l26",
      agent: true,
      net0: process.env.PROXMOX_CI_NET0 ?? "virtio,bridge=vmbr0",
      scsi0: `${vmStorage}:${process.env.PROXMOX_CI_VM_DISK_GB ?? 128},discard=on,iothread=1,ssd=1`,
      ide2: Output.interpolate`${iso.volid},media=cdrom`,
      boot: "order=scsi0;ide2",
      start: true,
      taskTimeoutMs: 1_200_000,
      tags: ["alchemy", "ci", "proxmox"],
      extra: {
        bios: "ovmf",
        cpu: "host",
        efidisk0: `${vmStorage}:1,efitype=4m,pre-enrolled-keys=0`,
        machine: "q35",
        scsihw: "virtio-scsi-single",
      },
    });

    return { iso, vm };
  }),
);
