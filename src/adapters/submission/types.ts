export interface SubmissionInput {
  campaignSourceUrl: string;
  postUrl: string;
  platform: string;
}

export interface SubmissionOutcome {
  submitted: boolean;
  externalRef?: string;
  note?: string;
}

/**
 * A campaign submission channel. An official API adapter is preferred when one
 * exists; otherwise a Playwright adapter fills the on-site submission form. The
 * final submit is gated by an explicit confirmation during the MVP.
 */
export interface SubmissionAdapter {
  readonly name: string;
  /** Whether this adapter talks to an official API (vs. browser form-fill). */
  readonly official: boolean;
  submit(input: SubmissionInput): Promise<SubmissionOutcome>;
}
