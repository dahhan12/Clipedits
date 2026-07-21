import { describe, it, expect } from "vitest";
import {
  assertTransition,
  canTransition,
  isTerminal,
  InvalidTransitionError,
} from "@/lib/state/stateMachines";

describe("state machines", () => {
  it("allows valid campaign transitions and rejects invalid ones", () => {
    expect(canTransition("Campaign", "DISCOVERED", "PARSING")).toBe(true);
    expect(canTransition("Campaign", "PARSING", "PARSED")).toBe(true);
    expect(canTransition("Campaign", "CLOSED", "ACTIVE")).toBe(false);
    expect(() => assertTransition("Campaign", "CLOSED", "ACTIVE")).toThrow(InvalidTransitionError);
  });

  it("treats same-state as allowed (idempotent)", () => {
    expect(canTransition("Publication", "PUBLISHED", "PUBLISHED")).toBe(true);
  });

  it("blocks publishing out of terminal states", () => {
    expect(canTransition("Publication", "PUBLISHED", "PENDING")).toBe(false);
    expect(isTerminal("Publication", "PUBLISHED")).toBe(true);
  });

  it("requires a clip to pass through RENDERING before RENDERED", () => {
    expect(canTransition("ClipCandidate", "APPROVED", "RENDERED")).toBe(false);
    expect(canTransition("ClipCandidate", "APPROVED", "RENDERING")).toBe(true);
    expect(canTransition("ClipCandidate", "RENDERING", "RENDERED")).toBe(true);
  });

  it("submission cannot skip from PREPARED straight to APPROVED", () => {
    expect(canTransition("CampaignSubmission", "PREPARED", "APPROVED")).toBe(false);
    expect(canTransition("CampaignSubmission", "SUBMITTED", "APPROVED")).toBe(true);
  });

  it("job runs cannot leave SUCCEEDED", () => {
    expect(isTerminal("JobRun", "SUCCEEDED")).toBe(true);
    expect(canTransition("JobRun", "SUCCEEDED", "RUNNING")).toBe(false);
  });
});
