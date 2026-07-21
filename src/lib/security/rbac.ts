import type { Role } from "@/generated/prisma";

/**
 * Minimal role-based access control. In Phase 1 the current role is read from a
 * trusted header set by the edge/proxy (or defaulted to VIEWER). Later phases
 * replace `currentRole` with a real session lookup — the `can()` policy stays.
 */

export type Action =
  | "campaign.reparse"
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
    "campaign.reparse",
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

/** Read the caller's role from a trusted proxy header. Defaults to VIEWER. */
export function currentRole(headers: Headers): Role {
  const raw = (headers.get("x-clipper-role") ?? "VIEWER").toUpperCase();
  if (raw === "ADMIN" || raw === "OPERATOR" || raw === "VIEWER") return raw;
  return "VIEWER";
}
