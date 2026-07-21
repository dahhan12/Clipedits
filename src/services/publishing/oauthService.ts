import { prisma } from "@/lib/db/prisma";
import { audit } from "@/lib/db/audit";
import { env, isSandbox } from "@/lib/config/env";
import { logger } from "@/lib/logging/logger";
import { encryptSecret, decryptSecret } from "@/lib/security/crypto";
import type { Platform } from "@/generated/prisma";

/**
 * OAuth token management for connected social accounts.
 *
 * Refresh tokens are stored AES-256-GCM-encrypted (`encryptedRefreshToken`) and
 * never returned to clients or written to logs. Access tokens are obtained by
 * exchanging the refresh token at the provider's token endpoint at publish time
 * and are held only in memory.
 */

/** Connect (or update) an account, encrypting its refresh token at rest. */
export async function connectAccount(input: {
  platform: Platform;
  handle: string;
  refreshToken: string;
  externalId?: string;
  scopes?: string;
}): Promise<string> {
  const account = await prisma.socialAccount.upsert({
    where: { platform_handle: { platform: input.platform, handle: input.handle } },
    create: {
      platform: input.platform,
      handle: input.handle,
      externalId: input.externalId,
      scopes: input.scopes,
      encryptedRefreshToken: encryptSecret(input.refreshToken),
    },
    update: {
      externalId: input.externalId,
      scopes: input.scopes,
      encryptedRefreshToken: encryptSecret(input.refreshToken),
      active: true,
    },
  });
  await audit({ action: "account.connected", entityType: "SocialAccount", entityId: account.id, metadata: { platform: input.platform } });
  return account.id;
}

const TOKEN_ENDPOINTS: Record<Platform, string> = {
  TIKTOK: "https://open.tiktokapis.com/v2/oauth/token/",
  INSTAGRAM_REELS: "https://graph.facebook.com/v19.0/oauth/access_token",
  YOUTUBE_SHORTS: "https://oauth2.googleapis.com/token",
};

/**
 * Obtain a fresh access token for an account by exchanging its stored refresh
 * token. Returns null when the platform is in sandbox mode (no client creds) or
 * the account has no stored token — callers then fall back to DRAFT preparation.
 */
export async function getAccessToken(accountId: string): Promise<string | null> {
  const account = await prisma.socialAccount.findUnique({ where: { id: accountId } });
  if (!account?.encryptedRefreshToken) return null;

  const sandbox =
    (account.platform === "TIKTOK" && isSandbox.tiktok()) ||
    (account.platform === "INSTAGRAM_REELS" && isSandbox.instagram()) ||
    (account.platform === "YOUTUBE_SHORTS" && isSandbox.youtube());
  if (sandbox) return null;

  const refreshToken = decryptSecret(account.encryptedRefreshToken);
  const body = tokenRequestBody(account.platform, refreshToken);

  try {
    const resp = await fetch(TOKEN_ENDPOINTS[account.platform], {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body).toString(),
    });
    if (!resp.ok) {
      logger.warn({ platform: account.platform, status: resp.status }, "Token refresh failed");
      return null;
    }
    const json = (await resp.json()) as { access_token?: string };
    return json.access_token ?? null;
  } catch (err) {
    logger.warn({ err, platform: account.platform }, "Token refresh error");
    return null;
  }
}

function tokenRequestBody(platform: Platform, refreshToken: string): Record<string, string> {
  switch (platform) {
    case "TIKTOK":
      return {
        client_key: env.TIKTOK_CLIENT_KEY ?? "",
        client_secret: env.TIKTOK_CLIENT_SECRET ?? "",
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      };
    case "INSTAGRAM_REELS":
      return {
        grant_type: "fb_exchange_token",
        client_id: env.INSTAGRAM_APP_ID ?? "",
        client_secret: env.INSTAGRAM_APP_SECRET ?? "",
        fb_exchange_token: refreshToken,
      };
    case "YOUTUBE_SHORTS":
      return {
        client_id: env.YOUTUBE_CLIENT_ID ?? "",
        client_secret: env.YOUTUBE_CLIENT_SECRET ?? "",
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      };
  }
}
