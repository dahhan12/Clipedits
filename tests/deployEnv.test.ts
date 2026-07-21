import { describe, it, expect } from "vitest";
import { checkDeployment, isProdLikeEnv, type DeployConfig } from "@/lib/config/deployEnv";

const base: DeployConfig = {
  appEnv: "local",
  encryptionKey: "k",
  sessionSecret: "s",
  databaseUrl: "postgresql://u:p@localhost:5432/dev",
  tiktokAudited: false,
  instagramApproved: false,
  youtubeVerified: false,
};

describe("deployment env guard", () => {
  it("passes a clean local config", () => {
    expect(checkDeployment(base)).toEqual([]);
  });

  it("blocks production publishing approvals in local/CI (prod creds guard)", () => {
    const problems = checkDeployment({ ...base, appEnv: "ci", tiktokAudited: true });
    expect(problems.join(" ")).toMatch(/TIKTOK_AUDITED/);
  });

  it("blocks an obviously-production DATABASE_URL in local/CI", () => {
    const problems = checkDeployment({ ...base, appEnv: "local", databaseUrl: "postgres://x@db-prod-1/app" });
    expect(problems.join(" ")).toMatch(/production database/);
  });

  it("requires secrets in staging/production", () => {
    const problems = checkDeployment({ appEnv: "production", tiktokAudited: false, instagramApproved: false, youtubeVerified: false });
    expect(problems).toContain("ENCRYPTION_KEY is required");
    expect(problems).toContain("DATABASE_URL is required");
  });

  it("allows audited approvals in staging/production", () => {
    const problems = checkDeployment({ ...base, appEnv: "staging", tiktokAudited: true });
    expect(problems).toEqual([]);
  });

  it("classifies prod-like tiers", () => {
    expect(isProdLikeEnv("staging")).toBe(true);
    expect(isProdLikeEnv("production")).toBe(true);
    expect(isProdLikeEnv("local")).toBe(false);
    expect(isProdLikeEnv("ci")).toBe(false);
  });
});
