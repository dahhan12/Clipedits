/**
 * Small time helpers shared across services. Kept UTC-only so aggregates keyed
 * on "day" (usage counters, provider stats) bucket consistently regardless of
 * server timezone.
 */

/** Today's date at UTC midnight — the canonical per-day bucket key. */
export function utcToday(): Date {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
