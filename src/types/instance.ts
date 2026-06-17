export type InstanceStatus = "not_found" | "creating" | "running" | "stopped";

export interface InstancePolicy {
  idle_timeout_minutes: number;
  schedule_stop: string;
}

export interface InstanceInfo {
  status: InstanceStatus;
  ingress_url: string;
  api_token: string;
  created_at: string;
  last_active_at: string;
  policy: InstancePolicy;
}

export interface InstanceConnectResponse {
  ingress_url: string;
  api_token: string;
}
