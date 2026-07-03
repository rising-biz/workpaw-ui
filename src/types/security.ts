/**
 * Security-related types for the Control Plane `/api/me/*` endpoints (Phase A).
 *
 * Note: `PendingApproval` (tool-execution approvals sourced from the QwenPaw
 * Pod via `/console/push-messages`) is NOT defined here — it lives in the
 * desktop's `lib/inboxApi.ts` because it is Pod-specific. The types below are
 * Control-Plane-sourced and shared across frontends.
 */

export type ApprovalDecision = "approve" | "deny";

/** An MCP service connected to the user's agent instance. */
export interface ConnectedMcp {
  name: string;
  /** true = the service is outside the corporate network (data egress risk). */
  external: boolean;
}

/** Security metadata for the user's current agent session. */
export interface SessionSecurity {
  /** Whether the agent runs inside a sandbox. */
  sandboxed: boolean;
  /** Sandbox root directory, if sandboxed. */
  sandbox_dir?: string;
  connected_mcp: ConnectedMcp[];
  /** Whether transport is encrypted. */
  encrypted: boolean;
  /** Data residency region, e.g. "cn-beijing". */
  data_region?: string;
}

export type AuditStepKind =
  | "read"
  | "write"
  | "shell"
  | "mcp"
  | "network"
  | "approval";

export type AuditStepStatus = "ok" | "approved" | "denied";

/** A single step in an audited agent operation. */
export interface AuditStep {
  kind: AuditStepKind;
  /** What was acted upon — file path, command, URL, MCP tool, etc. */
  target: string;
  status: AuditStepStatus;
}

/**
 * One entry in the current user's own operation history (employee self-view,
 * not the admin audit log). Source of truth: Control Plane, populated by
 * Desktop reporting observed tool_call events during SSE streaming.
 */
export interface AuditEntry {
  /** ISO 8601 timestamp. */
  timestamp: string;
  session_id: string;
  agent_id: string;
  step: AuditStep;
  tokens?: number;
  duration_ms?: number;
}
