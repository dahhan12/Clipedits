import { describe, it, expect } from "vitest";
import { classifyFailure, isRetryableCategory } from "@/lib/observability/failureCategory";
import { MediaTimeoutError, MediaValidationError } from "@/lib/media/ffmpeg";

describe("classifyFailure", () => {
  it("classifies rights/permission failures and marks them non-retryable", () => {
    const c = classifyFailure(new Error("Render blocked — rights: source use is DENIED"));
    expect(c.category).toBe("RIGHTS_DENIED");
    expect(c.retryable).toBe(false);
  });

  it("classifies rate limiting as retryable", () => {
    const c = classifyFailure(new Error("Request failed: 429 Too Many Requests"));
    expect(c.category).toBe("RATE_LIMITED");
    expect(c.retryable).toBe(true);
  });

  it("classifies transient network errors as retryable", () => {
    expect(classifyFailure(new Error("connect ECONNREFUSED 127.0.0.1:6379")).category).toBe(
      "TRANSIENT_NETWORK",
    );
    expect(classifyFailure(new Error("connect ECONNREFUSED 127.0.0.1:6379")).retryable).toBe(true);
  });

  it("classifies media validation/timeout by error class name", () => {
    expect(classifyFailure(new MediaValidationError("corrupt input")).category).toBe("MEDIA_INVALID");
    expect(classifyFailure(new MediaTimeoutError("ffmpeg killed")).category).toBe("TIMEOUT");
  });

  it("classifies missing configuration", () => {
    expect(classifyFailure(new Error("Missing env: ANTHROPIC_API_KEY not configured")).category).toBe(
      "CONFIG_MISSING",
    );
  });

  it("classifies provider rejections as non-retryable", () => {
    const c = classifyFailure(new Error("Publish rejected: 403 policy violation"));
    expect(c.category).toBe("PROVIDER_REJECTED");
    expect(c.retryable).toBe(false);
  });

  it("falls back to UNKNOWN (non-retryable) for unrecognised errors", () => {
    const c = classifyFailure(new Error("something entirely novel happened"));
    expect(c.category).toBe("UNKNOWN");
    expect(c.retryable).toBe(false);
  });

  it("never throws on non-Error inputs", () => {
    expect(classifyFailure(null).category).toBe("UNKNOWN");
    expect(classifyFailure("plain string 429").category).toBe("RATE_LIMITED");
  });

  it("isRetryableCategory agrees with classification", () => {
    expect(isRetryableCategory("TRANSIENT_NETWORK")).toBe(true);
    expect(isRetryableCategory("RIGHTS_DENIED")).toBe(false);
  });
});
