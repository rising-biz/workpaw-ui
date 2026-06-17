export interface ApiClientConfig {
  baseUrl: string;
  getToken: () => string | null;
  onUnauthorized?: () => void;
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
        this.config.onUnauthorized?.();
      }
      const text = await response.text().catch(() => "");
      throw new Error(
        `API Error: ${response.status} ${response.statusText} - ${text}`,
      );
    }

    if (response.status === 204) return undefined as T;

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
