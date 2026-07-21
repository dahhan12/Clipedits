import { describe, it, expect } from "vitest";
import { assertSafeUrl, isBlockedAddress, UrlValidationError } from "@/lib/security/url";

describe("isBlockedAddress", () => {
  it("blocks loopback, private, link-local and metadata addresses", () => {
    for (const ip of ["127.0.0.1", "10.0.0.5", "192.168.1.1", "172.16.0.1", "169.254.169.254", "::1"]) {
      expect(isBlockedAddress(ip)).toBe(true);
    }
  });
  it("allows public addresses", () => {
    expect(isBlockedAddress("8.8.8.8")).toBe(false);
    expect(isBlockedAddress("1.1.1.1")).toBe(false);
  });
});

describe("assertSafeUrl", () => {
  it("rejects non-http(s) schemes", async () => {
    await expect(assertSafeUrl("file:///etc/passwd")).rejects.toBeInstanceOf(UrlValidationError);
  });
  it("rejects credentialed URLs", async () => {
    await expect(
      assertSafeUrl("https://user:pass@example.com", { skipDnsResolution: true }),
    ).rejects.toBeInstanceOf(UrlValidationError);
  });
  it("rejects literal private IPs", async () => {
    await expect(assertSafeUrl("http://127.0.0.1/x")).rejects.toBeInstanceOf(UrlValidationError);
  });
  it("enforces the download allowlist", async () => {
    await expect(
      assertSafeUrl("https://evil.example.com/f.mp4", {
        enforceDownloadAllowlist: true,
        skipDnsResolution: true,
      }),
    ).rejects.toBeInstanceOf(UrlValidationError);
    await expect(
      assertSafeUrl("https://drive.google.com/file/d/abc", {
        enforceDownloadAllowlist: true,
        skipDnsResolution: true,
      }),
    ).resolves.toBeInstanceOf(URL);
  });
});
