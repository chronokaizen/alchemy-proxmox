import { ContainerProvider, Container } from "./Container.js";
import { Storage, StorageProvider } from "./Storage.js";
import {
  ContainerTemplate,
  ContainerTemplateProvider,
  IsoImage,
  IsoImageProvider,
} from "./StorageFile.js";
import { VirtualMachineProvider, VirtualMachine } from "./VirtualMachine.js";
import { ZfsPool, ZfsPoolProvider } from "./ZfsPool.js";
import { providers } from "./Providers.js";

export * from "./client.js";
export * from "./config.js";
export * from "./Container.js";
export * from "./Providers.js";
export * from "./Storage.js";
export * from "./StorageFile.js";
export * from "./VirtualMachine.js";
export * from "./ZfsPool.js";

export const ProxmoxProvider = providers;

export const Proxmox = {
  Container,
  ContainerProvider,
  ContainerTemplate,
  ContainerTemplateProvider,
  IsoImage,
  IsoImageProvider,
  Provider: ProxmoxProvider,
  Storage,
  StorageProvider,
  VirtualMachine,
  VirtualMachineProvider,
  ZfsPool,
  ZfsPoolProvider,
  providers,
};
