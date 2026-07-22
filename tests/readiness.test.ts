import { describe, it, expect } from "vitest";
import { applyVerifications, providerReadiness, type ProviderReadiness } from "@/lib/providers/readiness";
import type { VerificationRecord } from "@/lib/providers/verification";

const base: ProviderReadiness[] = [
  { key: "anthropic", name: "A", category: "ai", status: "SANDBOX_VERIFIED", credentialsPresent: false, note: "base" },
  { key: "tiktok", name: "T", category: "publishing", status: "BLOCKED_BY_PLATFORM_APPROVAL", credentialsPresent: false, requiresApproval: true, note: "base" },
];

function rec(ok: boolean): VerificationRecord {
  return { ok, detail: ok ? "passed smoke check" : "connection refused", at: "2026-07-22T00:00:00.000Z" };
}

describe("applyVerifications", () => {
  it("leaves providers untouched when there is no record", () => {
    const out = applyVerifications(base, {});
    expect(out[0]!.status).toBe("SANDBOX_VERIFIED");
    expect(out[0]!.lastVerifiedAt).toBeUndefined();
  });

  it("promotes to LIVE_VERIFIED on a positive record and stamps the time", () => {
    const out = applyVerifications(base, { anthropic: rec(true) });
    expect(out[0]!.status).toBe("LIVE_VERIFIED");
    expect(out[0]!.lastVerifiedAt).toBe("2026-07-22T00:00:00.000Z");
    expect(out[0]!.note).toContain("Live-verified");
  });

  it("keeps base status but surfaces failure on a negative record", () => {
    const out = applyVerifications(base, { anthropic: rec(false) });
    expect(out[0]!.status).toBe("SANDBOX_VERIFIED"); // not promoted
    expect(out[0]!.lastVerifiedAt).toBe("2026-07-22T00:00:00.000Z");
    expect(out[0]!.note).toContain("FAILED");
  });

  it("can promote an approval-gated provider only via an explicit positive record", () => {
    expect(applyVerifications(base, {})[1]!.status).toBe("BLOCKED_BY_PLATFORM_APPROVAL");
    expect(applyVerifications(base, { tiktok: rec(true) })[1]!.status).toBe("LIVE_VERIFIED");
  });

  it("providerReadiness with no records returns the conservative base (nothing LIVE_VERIFIED)", () => {
    const rows = providerReadiness();
    expect(rows.some((r) => r.status === "LIVE_VERIFIED")).toBe(false);
    expect(rows.length).toBeGreaterThan(0);
  });
});
