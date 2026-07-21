import { describe, it, expect } from "vitest";
import { computeCapabilities } from "@/services/publishing/capabilityService";

const base = {
  accountConnected: true,
  requiresInAppAudioOrEffects: false,
  complianceOutcome: "PASS" as const,
  envAllowsPublic: true, // isolate audit gating from deploy-tier gating
};

describe("computeCapabilities", () => {
  it("blocks everything on compliance FAIL", () => {
    const r = computeCapabilities({ ...base, platform: "TIKTOK", complianceOutcome: "FAIL" });
    expect(r.canPublishPublicly).toBe(false);
    expect(r.maxMode).toBe("MANUAL");
  });

  it("caps at local draft with no connected account", () => {
    const r = computeCapabilities({ ...base, platform: "TIKTOK", accountConnected: false });
    expect(r.capabilities).toContain("LOCAL_DRAFT");
    expect(r.canPublishPublicly).toBe(false);
    expect(r.maxMode).toBe("DRAFT");
  });

  it("forces draft when in-app audio/effects are required", () => {
    const r = computeCapabilities({ ...base, platform: "TIKTOK", requiresInAppAudioOrEffects: true, audited: true });
    expect(r.maxMode).toBe("DRAFT");
    expect(r.canPublishPublicly).toBe(false);
  });

  it("unaudited TikTok cannot publish publicly (inbox draft only)", () => {
    const r = computeCapabilities({ ...base, platform: "TIKTOK", audited: false });
    expect(r.capabilities).toContain("PLATFORM_DRAFT");
    expect(r.capabilities).not.toContain("DIRECT_POST");
    expect(r.maxMode).toBe("DRAFT");
  });

  it("unverified YouTube project is private-upload only", () => {
    const r = computeCapabilities({ ...base, platform: "YOUTUBE_SHORTS", audited: false });
    expect(r.capabilities).toContain("PRIVATE_UPLOAD");
    expect(r.capabilities).not.toContain("PUBLIC_UPLOAD");
    expect(r.maxMode).toBe("DRAFT");
  });

  it("audited + compliant TikTok can AUTO direct-post", () => {
    const r = computeCapabilities({ ...base, platform: "TIKTOK", audited: true });
    expect(r.capabilities).toContain("DIRECT_POST");
    expect(r.maxMode).toBe("AUTO");
  });

  it("local/CI tier can never publish publicly, even audited + compliant", () => {
    const r = computeCapabilities({ ...base, platform: "TIKTOK", audited: true, envAllowsPublic: false });
    expect(r.canPublishPublicly).toBe(false);
    expect(r.maxMode).toBe("DRAFT");
    expect(r.reasons.join(" ")).toMatch(/does not permit public posting/);
  });

  it("audited YouTube with unresolved REVIEW stays draft", () => {
    const r = computeCapabilities({ ...base, platform: "YOUTUBE_SHORTS", audited: true, complianceOutcome: "REVIEW" });
    expect(r.capabilities).toContain("PUBLIC_UPLOAD");
    expect(r.maxMode).toBe("DRAFT");
  });
});
