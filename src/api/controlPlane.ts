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
    return this.client.post<AuthTokens>("/api/auth/refresh", {
      refresh_token: refreshToken,
    });
  }

  logout(): Promise<void> {
    return this.client.post<void>("/api/auth/logout");
  }

  getInstance(): Promise<InstanceInfo> {
    return this.client.get<InstanceInfo>("/api/instance");
  }

  activateInstance(): Promise<InstanceInfo> {
    return this.client.post<InstanceInfo>("/api/instance/activate");
  }

  deactivateInstance(): Promise<void> {
    return this.client.post<void>("/api/instance/deactivate");
  }

  getConnectInfo(): Promise<InstanceConnectResponse> {
    return this.client.get<InstanceConnectResponse>("/api/instance/connect");
  }
}
