import type { Role } from "@/generated/prisma";
import { sessionFromCookieHeader } from "@/lib/security/session";

/**
 * Minimal role-based access control. In Phase 1 the current role is read from a
 * trusted header set by the edge/proxy (or defaulted to VIEWER). Later phases
 * replace `currentRole` with a real session lookup — the `can()` policy stays.
 */

export type Action =
  | "campaign.create"
  | "campaign.reparse"
  | "rule.review"
  | "rights.verify"
  | "resource.download"
  | "clip.generate"
  | "clip.approve"
  | "clip.reject"
  | "publish.draft"
  | "publish.now"
  | "submission.submit"
  | "job.retry";

const POLICY: Record<Role, Action[] | "*"> = {
  ADMIN: "*",
  OPERATOR: [
    "campaign.create",
    "campaign.reparse",
    "rule.review",
    "rights.verify",
    "resource.download",
    "clip.generate",
    "clip.approve",
    "clip.reject",
    "publish.draft",
    "job.retry",
  ],
  VIEWER: [],
};

export function can(role: Role, action: Action): boolean {
  const allowed = POLICY[role];
  return allowed === "*" || allowed.includes(action);
}

/**
 * Resolve the caller's role. Prefers a valid signed session cookie; falls back
 * to the `x-clipper-role` header (dev/proxy) and finally VIEWER.
 */
export function currentRole(headers: Headers): Role {
  const session = sessionFromCookieHeader(headers.get("cookie"));
  if (session) return session.role;
  const raw = (headers.get("x-clipper-role") ?? "VIEWER").toUpperCase();
  if (raw === "ADMIN" || raw === "OPERATOR" || raw === "VIEWER") return raw;
  return "VIEWER";
}
