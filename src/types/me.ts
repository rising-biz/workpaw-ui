/**
 * Types for the Control Plane `/api/me/*` endpoints (Phase A — enterprise security).
 *
 * These are WorkPaw-owned endpoints surfaced to the authenticated end user
 * (not admin). Naming follows snake_case to match the Go backend json tags
 * and the rest of this package (see AuthUser, Scenario).
 */

/** Granular permission level for a single capability. */
export type PolicyLevel = "allow" | "approve" | "deny";

/**
 * A single capability permission tier.
 * `capability` is a dotted key, e.g. "file.write", "shell.exec",
 * "network.external", "mcp.<name>".
 */
export interface PolicyTier {
  capability: string;
  level: PolicyLevel;
  /** Human-readable reason for the restriction (shown in the UI tooltip). */
  reason?: string;
}

/**
 * The effective security policy for the current user, aggregated from
 * department/role templates by the Control Plane.
 */
export interface EffectivePolicy {
  tiers: PolicyTier[];
  /** Policy template name, e.g. "research-dept-v2.3". */
  source: string;
  /** Contact email for the admin owning this policy. */
  admin_contact: string;
  /** Optimistic-lock version of the policy row. */
  version: number;
}

/** Token/cost usage for the current user. */
export interface MyUsage {
  today_tokens: number;
  month_tokens: number;
  /** Cost in CNY, computed from a model price table in the Control Plane. */
  today_cost_cny: number;
  month_cost_cny: number;
  /** Optional monthly budget cap; UI turns orange when approaching it. */
  month_budget_cny?: number;
}

export type PolicyRequestStatus = "pending" | "approved" | "rejected";

/**
 * An employee-submitted request to relax a policy tier
 * (e.g. "I need to write to /data/reports/weekly without approval").
 * Reviewed by an admin on the Admin Console side.
 */
export interface PolicyAdjustmentRequest {
  id: string;
  capability: string;
  requested_level: "allow" | "approve";
  reason: string;
  status: PolicyRequestStatus;
  /** ISO 8601 timestamp. */
  created_at: string;
}
