import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const outDir = process.env.PROXMOX_CI_ASSET_DIR ?? ".generated/proxmox-ci";

const values = {
  PROXMOX_CI_KEYBOARD: process.env.PROXMOX_CI_KEYBOARD ?? "en-us",
  PROXMOX_CI_COUNTRY: process.env.PROXMOX_CI_COUNTRY ?? "my",
  PROXMOX_CI_FQDN: required("PROXMOX_CI_FQDN"),
  PROXMOX_CI_MAILTO: process.env.PROXMOX_CI_MAILTO ?? "ci@invesai.live",
  PROXMOX_CI_TIMEZONE: process.env.PROXMOX_CI_TIMEZONE ?? "Asia/Kuala_Lumpur",
  PROXMOX_CI_ROOT_PASSWORD: required("PROXMOX_CI_ROOT_PASSWORD"),
  PROXMOX_CI_CLOUDFLARED_TOKEN:
    process.env.PROXMOX_CI_CLOUDFLARED_TOKEN ?? "",
  PROXMOX_CI_NETWORK_FILTER: networkFilter(),
  ...networkValues(),
};

await render(
  ".github/proxmox-ci/answer.toml.template",
  join(outDir, "answer.toml"),
);
await render(
  ".github/proxmox-ci/first-boot.sh.template",
  join(outDir, "first-boot.sh"),
);

console.log(`Rendered Proxmox CI installer assets into ${outDir}`);

async function render(source, target) {
  const input = await readFile(source, "utf8");
  const output = Object.entries(values).reduce(
    (text, [key, value]) => text.replaceAll(`__${key}__`, value),
    input,
  );

  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, output, {
    mode: target.endsWith(".sh") ? 0o700 : 0o600,
  });
}

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function networkValues() {
  const cidr =
    process.env.PROXMOX_CI_CIDR ??
    (process.env.PROXMOX_CI_ADDRESS
      ? `${process.env.PROXMOX_CI_ADDRESS}/${process.env.PROXMOX_CI_PREFIX ?? "24"}`
      : undefined);
  if (!cidr) {
    return {
      PROXMOX_CI_NETWORK_SOURCE: "from-dhcp",
      PROXMOX_CI_NETWORK_STATIC: "",
    };
  }

  return {
    PROXMOX_CI_NETWORK_SOURCE: "from-answer",
    PROXMOX_CI_NETWORK_STATIC: [
      `cidr = "${cidr}"`,
      `dns = "${required("PROXMOX_CI_DNS")}"`,
      `gateway = "${required("PROXMOX_CI_GATEWAY")}"`,
    ].join("\n"),
  };
}

function networkFilter() {
  const mac = process.env.PROXMOX_CI_MAC_ADDRESS;
  if (mac) {
    return `filter.ID_NET_NAME_MAC = "enx${mac.replaceAll(":", "").toLowerCase()}"`;
  }

  return `filter.ID_NET_NAME = "${process.env.PROXMOX_CI_NETWORK_FILTER_ID_NET_NAME ?? "ens18"}"`;
}
