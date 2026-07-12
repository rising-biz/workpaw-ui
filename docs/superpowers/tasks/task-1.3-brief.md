# Task 1.3: API 客户端

**Work in:** `/Users/zhangsan/workpaw/workpaw-ui`

**Files to create:**

### 1. `src/api/client.ts` - 通用 API 客户端

```typescript
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
      throw new Error(`API Error: ${response.status} ${response.statusText} - ${text}`);
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
```

### 2. `src/api/controlPlane.ts` - Control Plane API 封装

```typescript
import { ApiClient } from "./client";
import type { AuthLoginResponse, AuthTokens } from "../types/auth";
import type { InstanceInfo, InstanceConnectResponse } from "../types/instance";

export class ControlPlaneApi {
  private client: ApiClient;

  constructor(client: ApiClient) {
    this.client = client;
  }

  getLoginUrl(): Promise<AuthLoginResponse> {
    return this.client.get<AuthLoginResponse>("/api/auth/login");
  }

  refreshToken(refreshToken: string): Promise<AuthTokens> {
    return this.client.post<AuthTokens>("/api/auth/refresh", { refresh_token: refreshToken });
  }

  logout(): Promise<void> {
    return this.client.post("/api/auth/logout");
  }

  getInstance(): Promise<InstanceInfo> {
    return this.client.get<InstanceInfo>("/api/instance");
  }

  activateInstance(): Promise<InstanceInfo> {
    return this.client.post<InstanceInfo>("/api/instance/activate");
  }

  deactivateInstance(): Promise<void> {
    return this.client.post("/api/instance/deactivate");
  }

  getConnectInfo(): Promise<InstanceConnectResponse> {
    return this.client.get<InstanceConnectResponse>("/api/instance/connect");
  }
}
```

### 3. Update `src/index.ts` to also export API client:

Add these lines to existing exports:
```typescript
// API Client
export { ApiClient } from "./api/client";
export type { ApiClientConfig } from "./api/client";
export { ControlPlaneApi } from "./api/controlPlane";
```

**Acceptance:** Files created, exported from index.ts, `npx tsc --noEmit` passes.
