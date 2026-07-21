import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { z } from "zod";
import { currentRole } from "@/lib/security/rbac";
import { sessionFromCookieHeader } from "@/lib/security/session";
import { setHalted, setGlobalDailyCapUsd, getKillSwitchState } from "@/services/ops/killSwitch";
import { logger } from "@/lib/logging/logger";

const BodySchema = z.union([
  z.object({ area: z.enum(["publishing", "rendering", "ai"]), halted: z.boolean() }),
  z.object({ globalDailyCapUsd: z.number().min(0).nullable() }),
]);

/**
 * Admin-only kill-switch + global-cap control. Toggling a switch halts spendy
 * work (publishing/rendering/ai) without a redeploy; setting the cap bounds
 * daily estimated spend. ADMIN only; CSRF enforced by same-origin middleware.
 */
export async function POST(req: Request) {
  const hdrs = await headers();
  if (currentRole(hdrs) !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const parsed = BodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

  const actor = sessionFromCookieHeader(hdrs.get("cookie"))?.userId ?? "admin";
  try {
    if ("area" in parsed.data) {
      await setHalted(parsed.data.area, parsed.data.halted, actor);
    } else {
      await setGlobalDailyCapUsd(parsed.data.globalDailyCapUsd, actor);
    }
    return NextResponse.json({ ok: true, state: await getKillSwitchState() });
  } catch (err) {
    logger.error({ err }, "killswitch update failed");
    return NextResponse.json({ error: "Update failed (is the DB reachable?)" }, { status: 502 });
  }
}
