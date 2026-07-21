import { prisma } from "@/lib/db/prisma";
import type { Role } from "@/generated/prisma";

/** Append an audit event. Every meaningful state change should record one. */
export async function audit(input: {
  action: string;
  entityType: string;
  entityId?: string;
  actor?: string;
  role?: Role;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await prisma.auditEvent.create({
    data: {
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      actor: input.actor ?? "system",
      role: input.role,
      metadata: input.metadata as object | undefined,
    },
  });
}
