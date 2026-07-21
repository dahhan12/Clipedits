import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { verifyPassword } from "@/lib/security/crypto";
import { createSession, SESSION_COOKIE, SESSION_MAX_AGE_SEC } from "@/lib/security/session";
import { audit } from "@/lib/db/audit";
import { env } from "@/lib/config/env";
import { logger } from "@/lib/logging/logger";

const BodySchema = z.object({ email: z.string().email(), password: z.string().min(1) });

/** Password login. On success sets an HttpOnly signed session cookie. */
export async function POST(req: Request) {
  const parsed = BodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

  const user = await prisma.user.findUnique({ where: { email: parsed.data.email } }).catch(() => null);
  // Constant-ish response regardless of which check fails (avoid user enumeration).
  if (!user || !user.active || !user.passwordHash || !verifyPassword(parsed.data.password, user.passwordHash)) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  const token = createSession({ userId: user.id, role: user.role, workspaceId: user.workspaceId });
  await audit({ action: "auth.login", entityType: "User", entityId: user.id, actor: user.email, role: user.role });

  const res = NextResponse.json({ ok: true, role: user.role });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SEC,
  });
  logger.info({ userId: user.id }, "User logged in");
  return res;
}
