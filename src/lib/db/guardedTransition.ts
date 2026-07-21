import { prisma } from "@/lib/db/prisma";
import { assertTransition, type EntityName } from "@/lib/state/stateMachines";

/**
 * Optimistic-concurrency + state-machine guarded status transition.
 *
 * Reads the current row, validates the transition against the entity's state
 * machine, then performs a version-checked `updateMany`. If another worker/user
 * changed the row in between (version mismatch) the update affects 0 rows and we
 * throw `StaleWriteError` — a stale worker can never overwrite newer state.
 *
 * A model delegate with `{ status, version }` and a versioned `updateMany` is
 * required; all lifecycle entities carry a `version Int @default(0)` column.
 */

export class StaleWriteError extends Error {
  constructor(entity: string, id: string) {
    super(`Stale write for ${entity} ${id}: row changed concurrently`);
    this.name = "StaleWriteError";
  }
}

interface Row {
  status: string;
  version: number;
}
interface Delegate {
  findUnique(args: { where: { id: string } }): Promise<Row | null>;
  updateMany(args: {
    where: { id: string; version: number };
    data: Record<string, unknown>;
  }): Promise<{ count: number }>;
}

/**
 * @param entity  state-machine entity name
 * @param delegate  prisma model delegate (e.g. `prisma.publication`)
 * @param id  row id
 * @param to  target status
 * @param extraData  additional fields to set atomically with the transition
 */
export async function guardedTransition(
  entity: EntityName,
  delegate: Delegate,
  id: string,
  to: string,
  extraData: Record<string, unknown> = {},
): Promise<void> {
  const current = await delegate.findUnique({ where: { id } });
  if (!current) throw new Error(`${entity} ${id} not found`);

  assertTransition(entity, current.status, to);

  const res = await delegate.updateMany({
    where: { id, version: current.version },
    data: { ...extraData, status: to, version: { increment: 1 } as unknown as number },
  });
  if (res.count === 0) throw new StaleWriteError(entity, id);
}

/** Convenience wrappers with the concrete delegate + type. */
export const transition = {
  campaign: (id: string, to: string, data?: Record<string, unknown>) =>
    guardedTransition("Campaign", prisma.campaign as unknown as Delegate, id, to, data),
  clipCandidate: (id: string, to: string, data?: Record<string, unknown>) =>
    guardedTransition("ClipCandidate", prisma.clipCandidate as unknown as Delegate, id, to, data),
  publication: (id: string, to: string, data?: Record<string, unknown>) =>
    guardedTransition("Publication", prisma.publication as unknown as Delegate, id, to, data),
  submission: (id: string, to: string, data?: Record<string, unknown>) =>
    guardedTransition("CampaignSubmission", prisma.campaignSubmission as unknown as Delegate, id, to, data),
};
