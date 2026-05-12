import * as Layer from "effect/Layer";
import * as Provider from "alchemy/Provider";
import { Container, ContainerProvider } from "./Container.js";
import { Storage, StorageProvider } from "./Storage.js";
import {
  ContainerTemplate,
  ContainerTemplateProvider,
  IsoImage,
  IsoImageProvider,
} from "./StorageFile.js";
import { VirtualMachine, VirtualMachineProvider } from "./VirtualMachine.js";
import { ZfsPool, ZfsPoolProvider } from "./ZfsPool.js";
import type { ProxmoxProviderOptions } from "./config.js";

export class Providers extends Provider.ProviderCollection<Providers>()(
  "Proxmox",
) {}

export const providers = (options: ProxmoxProviderOptions = {}) =>
  Layer.effect(
    Providers,
    Provider.collection([
      VirtualMachine,
      Container,
      IsoImage,
      ContainerTemplate,
      Storage,
      ZfsPool,
    ]),
  ).pipe(
    Layer.provide(
      Layer.mergeAll(
        VirtualMachineProvider(options),
        ContainerProvider(options),
        IsoImageProvider(options),
        ContainerTemplateProvider(options),
        StorageProvider(options),
        ZfsPoolProvider(options),
      ),
    ),
  );
