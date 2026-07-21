import { describe, it, expect } from "vitest";
import {
  evaluateReviewability,
  reviewCoversCurrentFindings,
  NON_OVERRIDABLE_CHECKS,
  type ComplianceFinding,
} from "@/services/publishing/prePublicationService";
import type { PrePublicationReview } from "@/generated/prisma";

function findings(spec: Record<string, string>): ComplianceFinding[] {
  return Object.entries(spec).map(([check, outcome]) => ({ check, outcome }));
}

function review(acknowledged: string[]): PrePublicationReview {
  return {
    id: "rev_1",
    renderedClipId: "rc_1",
    platform: "TIKTOK",
    mode: "AUTO",
    decision: "APPROVED",
    reviewerId: "u1",
    justification: "verified manually",
    acknowledgedChecks: acknowledged,
    createdAt: new Date(),
  } as unknown as PrePublicationReview;
}

describe("evaluateReviewability", () => {
  it("allows override when only waivable REVIEWs are present", () => {
    const r = evaluateReviewability(findings({ duration: "REVIEW", publicPostRequirement: "REVIEW", aspectRatio: "PASS" }));
    expect(r.hasFail).toBe(false);
    expect(r.waivableChecks.sort()).toEqual(["duration", "publicPostRequirement"]);
    expect(r.blockingChecks).toEqual([]);
    expect(r.canOverride).toBe(true);
  });

  it("blocks override when a FAIL is present", () => {
    const r = evaluateReviewability(findings({ duration: "REVIEW", fileFormat: "FAIL" }));
    expect(r.hasFail).toBe(true);
    expect(r.canOverride).toBe(false);
  });

  it("blocks override when a safety-critical check is under REVIEW", () => {
    const r = evaluateReviewability(findings({ sourcePermission: "REVIEW", duration: "REVIEW" }));
    expect(r.blockingChecks).toContain("sourcePermission");
    expect(r.canOverride).toBe(false);
  });

  it("cannot override when there is nothing to waive", () => {
    const r = evaluateReviewability(findings({ aspectRatio: "PASS", duration: "PASS" }));
    expect(r.canOverride).toBe(false);
  });

  it("treats rights, prohibited content and duplicates as non-overridable", () => {
    for (const c of ["sourcePermission", "prohibitedWords", "prohibitedContent", "perceptualDuplicate", "duplicateContent"]) {
      expect(NON_OVERRIDABLE_CHECKS.has(c)).toBe(true);
    }
  });
});

describe("reviewCoversCurrentFindings", () => {
  it("covers when the acknowledged set includes every current waivable REVIEW", () => {
    const f = findings({ duration: "REVIEW", publicPostRequirement: "REVIEW" });
    expect(reviewCoversCurrentFindings(review(["duration", "publicPostRequirement"]), f)).toBe(true);
  });

  it("does not cover when a new waivable REVIEW appeared after the review", () => {
    const f = findings({ duration: "REVIEW", fileSize: "REVIEW" });
    expect(reviewCoversCurrentFindings(review(["duration"]), f)).toBe(false);
  });

  it("does not cover when a FAIL appeared after the review", () => {
    const f = findings({ duration: "REVIEW", fileFormat: "FAIL" });
    expect(reviewCoversCurrentFindings(review(["duration"]), f)).toBe(false);
  });

  it("does not cover when a safety-critical REVIEW appeared after the review", () => {
    const f = findings({ duration: "REVIEW", sourcePermission: "REVIEW" });
    expect(reviewCoversCurrentFindings(review(["duration", "sourcePermission"]), f)).toBe(false);
  });

  it("null review never covers", () => {
    expect(reviewCoversCurrentFindings(null, findings({ duration: "REVIEW" }))).toBe(false);
  });
});
