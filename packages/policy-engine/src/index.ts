import { z } from "zod";

export const CapabilitySchema = z.enum([
  "fs.read",
  "fs.write",
  "fs.delete",
  "shell.exec",
  "network.request",
  "browser.read",
  "browser.submit",
  "email.read",
  "email.send",
  "calendar.read",
  "calendar.write",
  "clipboard.read",
  "notification.show",
  "secret.use"
]);

export type Capability = z.infer<typeof CapabilitySchema>;

export const PermissionGrantSchema = z.object({
  capability: CapabilitySchema,
  scope: z.record(z.string(), z.unknown()),
  constraint: z.record(z.string(), z.unknown()).optional(),
  decision: z.enum(["allow", "deny"]),
  source: z.enum(["system", "one_time", "session", "project", "user_default"]),
  expiresAt: z.string().datetime().optional()
});

export type PermissionGrant = z.infer<typeof PermissionGrantSchema>;

export interface PolicyDecision {
  decision: "allow" | "deny" | "approval_required";
  reason: string;
}

export function evaluatePhase0Policy(grants: readonly PermissionGrant[]): PolicyDecision {
  if (grants.some((grant) => grant.decision === "deny")) {
    return {
      decision: "deny",
      reason: "Explicit deny has priority."
    };
  }

  return {
    decision: "approval_required",
    reason: "Phase 0 does not execute tool calls."
  };
}
