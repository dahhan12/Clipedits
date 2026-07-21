import { lookup } from "node:dns/promises";
import net from "node:net";
import { downloadAllowedHosts } from "@/lib/config/env";

/**
 * URL validation + SSRF protection.
 *
 * Every externally supplied URL — discovered campaign links, resource links,
 * download targets — is passed through here before any network access. We
 * reject non-http(s) schemes, embedded credentials, and any host that resolves
 * to a private / loopback / link-local / metadata address.
 */

export class UrlValidationError extends Error {}

const BLOCKED_V4_CIDRS: Array<[string, number]> = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16], // link-local incl. 169.254.169.254 metadata
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

function ipv4ToInt(ip: string): number {
  return ip.split(".").reduce((acc, oct) => (acc << 8) + Number(oct), 0) >>> 0;
}

function isBlockedIpv4(ip: string): boolean {
  const addr = ipv4ToInt(ip);
  return BLOCKED_V4_CIDRS.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (addr & mask) === (ipv4ToInt(base) & mask);
  });
}

function isBlockedIpv6(ip: string): boolean {
  const v = ip.toLowerCase();
  if (v === "::1" || v === "::") return true; // loopback / unspecified
  if (v.startsWith("fe80")) return true; // link-local
  if (v.startsWith("fc") || v.startsWith("fd")) return true; // unique-local
  // IPv4-mapped (::ffff:a.b.c.d)
  const mapped = v.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped && mapped[1]) return isBlockedIpv4(mapped[1]);
  return false;
}

export function isBlockedAddress(ip: string): boolean {
  if (net.isIPv4(ip)) return isBlockedIpv4(ip);
  if (net.isIPv6(ip)) return isBlockedIpv6(ip);
  return true; // unknown format → block
}

export interface UrlCheckOptions {
  /** Enforce the download host allowlist (used before resource downloads). */
  enforceDownloadAllowlist?: boolean;
  /** Skip DNS resolution (e.g. offline/sandbox). Structural checks still run. */
  skipDnsResolution?: boolean;
}

/**
 * Validate a URL structurally and, unless skipped, resolve its host and ensure
 * every resolved address is publicly routable. Returns the parsed URL.
 */
export async function assertSafeUrl(
  raw: string,
  opts: UrlCheckOptions = {},
): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UrlValidationError(`Malformed URL: ${raw}`);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UrlValidationError(`Unsupported scheme: ${url.protocol}`);
  }
  if (url.username || url.password) {
    throw new UrlValidationError("Credentialed URLs are not allowed");
  }

  const host = url.hostname.toLowerCase();

  if (opts.enforceDownloadAllowlist) {
    const allowed = downloadAllowedHosts();
    const ok = allowed.some((h) => host === h || host.endsWith(`.${h}`));
    if (!ok) {
      throw new UrlValidationError(`Host not in download allowlist: ${host}`);
    }
  }

  // If a literal IP was supplied, check it directly.
  if (net.isIP(host)) {
    if (isBlockedAddress(host)) {
      throw new UrlValidationError(`Blocked address: ${host}`);
    }
    return url;
  }

  if (opts.skipDnsResolution) return url;

  let records: Array<{ address: string }>;
  try {
    records = await lookup(host, { all: true });
  } catch {
    throw new UrlValidationError(`DNS resolution failed for ${host}`);
  }
  if (records.length === 0) {
    throw new UrlValidationError(`No DNS records for ${host}`);
  }
  for (const rec of records) {
    if (isBlockedAddress(rec.address)) {
      throw new UrlValidationError(
        `Host ${host} resolves to blocked address ${rec.address}`,
      );
    }
  }
  return url;
}
