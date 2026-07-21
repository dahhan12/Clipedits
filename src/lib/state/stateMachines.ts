/**
 * Explicit state machines for every entity with a lifecycle. Transitions not
 * listed here are rejected, so a worker or user can never move a record into an
 * illegal state (e.g. publish after a terminal state, or re-approve a rendered
 * clip). Same-state transitions are allowed (idempotent no-ops).
 *
 * These tables are pure data; `assertTransition` is pure and unit-tested.
 * Services combine this with optimistic-concurrency guarded writes
 * (see `src/lib/db/guardedTransition.ts`).
 */

export class InvalidTransitionError extends Error {
  constructor(
    public readonly entity: string,
    public readonly from: string,
    public readonly to: string,
  ) {
    super(`Invalid ${entity} transition: ${from} → ${to}`);
    this.name = "InvalidTransitionError";
  }
}

type Table = Record<string, readonly string[]>;

export const CAMPAIGN_TRANSITIONS: Table = {
  DISCOVERED: ["PARSING", "CLOSED", "ERROR"],
  PARSING: ["PARSED", "NEEDS_MANUAL_REVIEW", "ERROR"],
  PARSED: ["PARSING", "ACTIVE", "PAUSED", "CLOSED", "NEEDS_MANUAL_REVIEW", "ERROR"],
  NEEDS_MANUAL_REVIEW: ["PARSING", "PARSED", "CLOSED", "ERROR"],
  ACTIVE: ["PAUSED", "CLOSED", "PARSING", "ERROR"],
  PAUSED: ["ACTIVE", "CLOSED", "PARSING", "ERROR"],
  CLOSED: ["PARSING", "ERROR"],
  ERROR: ["PARSING", "CLOSED"],
};

export const ASSET_TRANSITIONS: Table = {
  PENDING: ["DOWNLOADING", "READY", "FAILED"],
  DOWNLOADING: ["READY", "FAILED"],
  READY: ["FAILED"],
  FAILED: ["PENDING", "DOWNLOADING"],
};

export const CLIP_TRANSITIONS: Table = {
  CANDIDATE: ["APPROVED", "REJECTED", "FAILED"],
  APPROVED: ["RENDERING", "REJECTED", "CANDIDATE"],
  RENDERING: ["RENDERED", "FAILED"],
  RENDERED: [],
  REJECTED: ["CANDIDATE", "APPROVED"],
  FAILED: ["APPROVED", "CANDIDATE"],
};

export const PUBLICATION_TRANSITIONS: Table = {
  PENDING: ["DRAFTED", "PUBLISHED", "FAILED", "SKIPPED"],
  DRAFTED: ["PUBLISHED", "FAILED"],
  PUBLISHED: [],
  FAILED: ["PENDING"],
  SKIPPED: ["PENDING"],
};

export const SUBMISSION_TRANSITIONS: Table = {
  PREPARED: ["AWAITING_CONFIRMATION", "SUBMITTED", "FAILED"],
  AWAITING_CONFIRMATION: ["SUBMITTED", "FAILED", "PREPARED"],
  SUBMITTED: ["APPROVED", "REJECTED", "FAILED"],
  APPROVED: [],
  REJECTED: ["PREPARED"],
  FAILED: ["PREPARED", "AWAITING_CONFIRMATION"],
};

export const JOBRUN_TRANSITIONS: Table = {
  QUEUED: ["RUNNING", "SKIPPED"],
  RUNNING: ["SUCCEEDED", "FAILED", "SKIPPED"],
  SUCCEEDED: [],
  FAILED: ["RUNNING", "QUEUED"],
  SKIPPED: ["RUNNING", "QUEUED"],
};

export const TABLES = {
  Campaign: CAMPAIGN_TRANSITIONS,
  SourceAsset: ASSET_TRANSITIONS,
  ClipCandidate: CLIP_TRANSITIONS,
  Publication: PUBLICATION_TRANSITIONS,
  CampaignSubmission: SUBMISSION_TRANSITIONS,
  JobRun: JOBRUN_TRANSITIONS,
} as const;

export type EntityName = keyof typeof TABLES;

export function canTransition(entity: EntityName, from: string, to: string): boolean {
  if (from === to) return true;
  return (TABLES[entity][from] ?? []).includes(to);
}

/** Throws InvalidTransitionError if the transition is not allowed. */
export function assertTransition(entity: EntityName, from: string, to: string): void {
  if (!canTransition(entity, from, to)) throw new InvalidTransitionError(entity, from, to);
}

export function isTerminal(entity: EntityName, state: string): boolean {
  return (TABLES[entity][state] ?? []).length === 0;
}
