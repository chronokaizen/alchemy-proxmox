import * as Layer from "effect/Layer";
import * as Provider from "alchemy/Provider";
import { Container, ContainerProvider } from "./Container.js";
import { VirtualMachine, VirtualMachineProvider } from "./VirtualMachine.js";
import type { ProxmoxProviderOptions } from "./config.js";

export class Providers extends Provider.ProviderCollection<Providers>()(
  "Proxmox",
) {}

export const providers = (options: ProxmoxProviderOptions = {}) =>
  Layer.effect(
    Providers,
    Provider.collection([VirtualMachine, Container]),
  ).pipe(
    Layer.provide(
      Layer.mergeAll(VirtualMachineProvider(options), ContainerProvider(options)),
    ),
  );
