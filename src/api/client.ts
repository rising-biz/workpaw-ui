export interface ApiClientConfig {
  baseUrl: string;
  getToken: () => string | null;
  onUnauthorized?: () => void;
}

/**
 * Non-2xx API failure.
 *
 * `status` (and the parsed response `body`) travel as structured fields so
 * consumers can branch on them — e.g. `marketErrorMessage` matches
 * `value.status` and would never match a bare `Error`. The human-readable
 * message keeps the historical `API Error: <status> <statusText> - <body>`
 * format so consumers that (pre-)match on the message string stay intact.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, statusText: string, bodyText: string) {
    super(`API Error: ${status} ${statusText} - ${bodyText}`);
    this.name = "ApiError";
    this.status = status;
    try {
      this.body = JSON.parse(bodyText);
    } catch {
      this.body = bodyText;
    }
  }
}

/**
 * Same-frame 401 dedupe: several concurrent requests can all come back 401 in
 * one frame; the (redirect-shaped) `onUnauthorized` side effect must fire only
 * once for the batch. The flag re-arms on the next tick so a later, separate
 * batch still notifies, matching the previous per-request behavior otherwise.
 */
let unauthorizedSignalArmed = false;

function signalUnauthorized(config: ApiClientConfig): void {
  if (unauthorizedSignalArmed) return;
  unauthorizedSignalArmed = true;
  try {
    config.onUnauthorized?.();
  } finally {
    setTimeout(() => {
      unauthorizedSignalArmed = false;
    }, 0);
  }
}

export class ApiClient {
  private config: ApiClientConfig;

  constructor(config: ApiClientConfig) {
    this.config = config;
  }

  private buildHeaders(extra?: HeadersInit): Headers {
    const headers = new Headers(extra);
    const token = this.config.getToken();
    if (token) {
      headers.set("Authorization", `Bearer ${token}`);
    }
    return headers;
  }

  /**
   * Request passthrough: `options` is a standard RequestInit, so callers
   * needing cancellation or a deadline pass their own signal —
   * `request(path, { signal: AbortSignal.timeout(10_000) })` (ApiClient adds
   * no implicit timeout; `get/post/put/delete` don't expose one either).
   *
   * 204 responses resolve to `undefined` at runtime while the declared type
   * is still `T` — call sites hitting 204 endpoints should declare
   * `request<void>(…)` and treat the resolved value as absent (kept for
   * signature stability across consumers; the honest type would be
   * `T | undefined`).
   */
  async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.config.baseUrl}${path}`;
    const method = options.method || "GET";

    const headers = this.buildHeaders(options.headers);
    if (["POST", "PUT", "PATCH"].includes(method.toUpperCase())) {
      if (!headers.has("Content-Type")) {
        headers.set("Content-Type", "application/json");
      }
    }

    const response = await fetch(url, { ...options, headers });

    if (!response.ok) {
      if (response.status === 401) {
        signalUnauthorized(this.config);
      }
      const text = await response.text().catch(() => "");
      throw new ApiError(response.status, response.statusText, text);
    }

    if (response.status === 204) return undefined as T; // see request() doc

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      return (await response.text()) as unknown as T;
    }

    return (await response.json()) as T;
  }

  get<T>(path: string): Promise<T> {
    return this.request<T>(path);
  }

  post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>(path, {
      method: "POST",
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  put<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>(path, {
      method: "PUT",
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  delete<T>(path: string): Promise<T> {
    return this.request<T>(path, { method: "DELETE" });
  }
}
