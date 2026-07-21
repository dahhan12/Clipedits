import { assertSafeUrl } from "@/lib/security/url";
import { logger } from "@/lib/logging/logger";

/**
 * Best-effort check that a published post URL is publicly reachable. Returns
 * true only on a clearly successful public fetch; network errors or blocks
 * return false (the caller records "unverified" rather than failing the flow).
 */
export async function verifyPublicAccessible(postUrl: string): Promise<boolean> {
  try {
    await assertSafeUrl(postUrl);
  } catch {
    return false;
  }
  try {
    const resp = await fetch(postUrl, { method: "GET", redirect: "follow" });
    return resp.ok;
  } catch (err) {
    logger.warn({ err, postUrl }, "Public accessibility check failed");
    return false;
  }
}
