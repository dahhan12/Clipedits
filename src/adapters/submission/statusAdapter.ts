import type { PayoutStatus } from "@/generated/prisma";

export interface SubmissionStatusResult {
  approvalState: string | null; // e.g. "APPROVED" | "REJECTED" | "PENDING"
  rejectionReason: string | null;
  confirmedEarnings: number | null;
  payoutStatus: PayoutStatus | null;
}

/**
 * Reads a campaign submission's approval/payout status. Content Rewards exposes
 * no official status API, so a production implementation scrapes the authored
 * submission page via the persistent Playwright session. Until that is wired,
 * this returns "unknown" for every field — the tracker never fabricates a
 * status, it simply leaves the submission as-is.
 */
export interface SubmissionStatusAdapter {
  readonly name: string;
  poll(input: { campaignSourceUrl: string; postUrl: string | null }): Promise<SubmissionStatusResult>;
}

export class ContentRewardsStatusAdapter implements SubmissionStatusAdapter {
  readonly name = "content-rewards-status";
  async poll(): Promise<SubmissionStatusResult> {
    return { approvalState: null, rejectionReason: null, confirmedEarnings: null, payoutStatus: null };
  }
}
