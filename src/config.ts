import type { ProxmoxClientOptions } from "./client.js";

export interface ProxmoxProviderOptions extends Partial<ProxmoxClientOptions> {
  readonly waitTimeoutMs?: number;
  readonly waitIntervalMs?: number;
  readonly successExitStatuses?: readonly string[];
}

export interface ProxmoxCommonProps {
  readonly node: string;
  readonly vmid?: number;
  readonly name?: string;
  readonly description?: string;
  readonly tags?: string | string[];
  readonly start?: boolean;
  readonly wait?: boolean;
  readonly taskTimeoutMs?: number;
  readonly extra?: Record<string, string | number | boolean | undefined>;
}

export interface ProxmoxGuestAttributes {
  readonly node: string;
  readonly vmid: number;
  readonly name?: string;
  readonly status?: string;
  readonly type: "qemu" | "lxc";
}

export const tagsToString = (tags: string | string[] | undefined) =>
  Array.isArray(tags) ? tags.join(";") : tags;

export const withoutUndefined = <T extends Record<string, unknown>>(
  values: T,
): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(values).filter(([, value]) => value !== undefined),
  );
