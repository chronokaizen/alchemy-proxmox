export interface ProxmoxTicketCredentials {
  readonly username: string;
  readonly password: string;
  readonly realm?: string;
}

export interface ProxmoxApiTokenCredentials {
  readonly tokenId: string;
  readonly secret: string;
}

export interface ProxmoxClientOptions {
  readonly baseUrl: string;
  readonly credentials?: ProxmoxTicketCredentials | ProxmoxApiTokenCredentials;
  readonly rejectUnauthorized?: boolean;
  readonly fetch?: typeof fetch;
}

export interface ProxmoxEnvelope<T> {
  readonly data: T;
}

export interface ProxmoxTaskStatus {
  readonly status: "running" | "stopped";
  readonly exitstatus?: string;
}

export interface ProxmoxResourceSummary {
  readonly type: string;
  readonly node?: string;
  readonly vmid?: number;
  readonly name?: string;
  readonly status?: string;
}

export class ProxmoxApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly responseText: string,
  ) {
    super(message);
    this.name = "ProxmoxApiError";
  }
}

export const isProxmoxNotFound = (error: unknown): boolean =>
  error instanceof ProxmoxApiError &&
  (error.status === 404 ||
    /configuration file .* does not exist/i.test(error.responseText));

interface TicketSession {
  readonly ticket: string;
  readonly csrf: string;
}

const isApiTokenCredentials = (
  credentials: ProxmoxClientOptions["credentials"],
): credentials is ProxmoxApiTokenCredentials =>
  !!credentials && "tokenId" in credentials;

export class ProxmoxClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private ticketSession: TicketSession | undefined;

  constructor(private readonly options: ProxmoxClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.fetchImpl = options.fetch ?? fetch;
  }

  async get<T>(path: string, query?: Record<string, unknown>): Promise<T> {
    return this.request<T>("GET", path, { query });
  }

  async post<T>(path: string, body?: Record<string, unknown>): Promise<T> {
    return this.request<T>("POST", path, { body });
  }

  async put<T>(path: string, body?: Record<string, unknown>): Promise<T> {
    return this.request<T>("PUT", path, { body });
  }

  async delete<T>(path: string): Promise<T> {
    return this.request<T>("DELETE", path);
  }

  async nextId(): Promise<number> {
    const id = await this.get<string | number>("/cluster/nextid");
    return Number(id);
  }

  async resources(type?: "qemu" | "lxc"): Promise<ProxmoxResourceSummary[]> {
    return this.get<ProxmoxResourceSummary[]>("/cluster/resources", { type });
  }

  async waitForTask(
    node: string,
    upid: string,
    options: {
      timeoutMs?: number;
      intervalMs?: number;
      successExitStatuses?: readonly string[];
    } = {},
  ): Promise<void> {
    const timeoutMs = options.timeoutMs ?? 120_000;
    const intervalMs = options.intervalMs ?? 1_000;
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const status = await this.get<ProxmoxTaskStatus>(
        `/nodes/${encodeURIComponent(node)}/tasks/${encodeURIComponent(upid)}/status`,
      );

      if (status.status === "stopped") {
        const successExitStatuses = options.successExitStatuses ?? ["OK"];
        if (
          status.exitstatus &&
          !successExitStatuses.includes(status.exitstatus)
        ) {
          throw new Error(`Proxmox task failed with ${status.exitstatus}`);
        }
        return;
      }

      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }

    throw new Error(`Timed out waiting for Proxmox task ${upid}`);
  }

  private async request<T>(
    method: string,
    path: string,
    options: {
      readonly query?: Record<string, unknown>;
      readonly body?: Record<string, unknown>;
    } = {},
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}/api2/json${path}`);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }

    const headers = new Headers();
    const body = options.body ? encodeForm(options.body) : undefined;

    if (body) {
      headers.set("content-type", "application/x-www-form-urlencoded");
    }

    await this.authorize(headers, method);

    const response = await this.fetchImpl(url, {
      method,
      headers,
      body,
    });

    if (!response.ok) {
      const responseText = await response.text();
      throw new ProxmoxApiError(
        `Proxmox ${method} ${path} failed with ${response.status}`,
        response.status,
        responseText,
      );
    }

    const envelope = (await response.json()) as ProxmoxEnvelope<T>;
    return envelope.data;
  }

  private async authorize(headers: Headers, method: string): Promise<void> {
    const credentials = this.options.credentials;
    if (!credentials) {
      return;
    }

    if (isApiTokenCredentials(credentials)) {
      headers.set(
        "authorization",
        `PVEAPIToken=${credentials.tokenId}=${credentials.secret}`,
      );
      return;
    }

    const session = await this.getTicketSession(credentials);
    headers.set("cookie", `PVEAuthCookie=${session.ticket}`);
    if (method !== "GET") {
      headers.set("csrfpreventiontoken", session.csrf);
    }
  }

  private async getTicketSession(
    credentials: ProxmoxTicketCredentials,
  ): Promise<TicketSession> {
    if (this.ticketSession) {
      return this.ticketSession;
    }

    const username = credentials.username.includes("@")
      ? credentials.username
      : `${credentials.username}@${credentials.realm ?? "pam"}`;
    const response = await this.fetchImpl(
      `${this.baseUrl}/api2/json/access/ticket`,
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: encodeForm({ username, password: credentials.password }),
      },
    );

    if (!response.ok) {
      const responseText = await response.text();
      throw new ProxmoxApiError(
        `Proxmox authentication failed with ${response.status}`,
        response.status,
        responseText,
      );
    }

    const envelope = (await response.json()) as ProxmoxEnvelope<{
      readonly ticket: string;
      readonly CSRFPreventionToken: string;
    }>;
    this.ticketSession = {
      ticket: envelope.data.ticket,
      csrf: envelope.data.CSRFPreventionToken,
    };
    return this.ticketSession;
  }
}

const encodeForm = (values: Record<string, unknown>): URLSearchParams => {
  const form = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) {
      continue;
    }
    if (typeof value === "boolean") {
      form.set(key, value ? "1" : "0");
    } else if (Array.isArray(value)) {
      form.set(key, value.join(","));
    } else {
      form.set(key, String(value));
    }
  }
  return form;
};

export const createProxmoxClient = (options?: Partial<ProxmoxClientOptions>) => {
  const baseUrl = options?.baseUrl ?? process.env.PROXMOX_URL;
  if (!baseUrl) {
    throw new Error("PROXMOX_URL is required");
  }

  const credentials =
    options?.credentials ??
    (process.env.PROXMOX_API_TOKEN_ID && process.env.PROXMOX_API_TOKEN_SECRET
      ? {
          tokenId: process.env.PROXMOX_API_TOKEN_ID,
          secret: process.env.PROXMOX_API_TOKEN_SECRET,
        }
      : process.env.PROXMOX_USERNAME && process.env.PROXMOX_PASSWORD
        ? {
            username: process.env.PROXMOX_USERNAME,
            password: process.env.PROXMOX_PASSWORD,
            realm: process.env.PROXMOX_REALM,
          }
        : undefined);

  return new ProxmoxClient({
    ...options,
    baseUrl,
    credentials,
  });
};
