import { describe, it, expect, afterEach } from "vitest";
import crypto from "node:crypto";
import { encrypt, decrypt, needsRewrap, setKeyProvider, type KeyProvider } from "@/lib/security/envelope";

const keyA = crypto.randomBytes(32);
const keyB = crypto.randomBytes(32);

function provider(currentId: string, keys: Record<string, Buffer>): KeyProvider {
  return {
    current: () => ({ id: currentId, key: keys[currentId]! }),
    byId: (id: string) => keys[id] ?? null,
  };
}

afterEach(() => {
  // restore default provider behaviour for other suites
  setKeyProvider({
    current: () => ({ id: "1", key: keyA }),
    byId: (id) => (id === "1" ? keyA : null),
  });
});

describe("envelope encryption + rotation", () => {
  it("round-trips and embeds the current key id", () => {
    setKeyProvider(provider("1", { "1": keyA }));
    const ct = encrypt("s3cr3t-token");
    expect(ct.startsWith("cc1:1:")).toBe(true);
    expect(decrypt(ct)).toBe("s3cr3t-token");
  });

  it("decrypts data written under a RETIRED key after rotation", () => {
    // Written under key "1".
    setKeyProvider(provider("1", { "1": keyA }));
    const ct = encrypt("old-token");
    // Rotate: current is now "2"; key "1" retired but still available.
    setKeyProvider(provider("2", { "2": keyB, "1": keyA }));
    expect(decrypt(ct)).toBe("old-token"); // still decryptable
    expect(needsRewrap(ct)).toBe(true); // but flagged for rewrap
    const rewrapped = encrypt(decrypt(ct));
    expect(rewrapped.startsWith("cc1:2:")).toBe(true);
    expect(needsRewrap(rewrapped)).toBe(false);
  });

  it("fails when the key id is unknown (missing retired key)", () => {
    setKeyProvider(provider("1", { "1": keyA }));
    const ct = encrypt("x");
    setKeyProvider(provider("2", { "2": keyB })); // key 1 not retired -> unavailable
    expect(() => decrypt(ct)).toThrow(/No key available/);
  });

  it("detects tampering (auth failure) in header or body", () => {
    setKeyProvider(provider("1", { "1": keyA }));
    const ct = encrypt("tamper-me");
    const [, , body] = ct.split(":");
    // Flip the claimed key id (AAD mismatch) while key 9 doesn't exist -> throws.
    expect(() => decrypt(`cc1:9:${body}`)).toThrow();
    // Corrupt the body.
    const corrupt = Buffer.from(body!, "base64");
    corrupt[corrupt.length - 1] = (corrupt[corrupt.length - 1] ?? 0) ^ 0xff;
    expect(() => decrypt(`cc1:1:${corrupt.toString("base64")}`)).toThrow();
  });
});
