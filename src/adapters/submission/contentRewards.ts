import { logger } from "@/lib/logging/logger";
import { assertSafeUrl } from "@/lib/security/url";
import { withPersistentContext } from "@/adapters/discovery/browser";
import type { SubmissionAdapter, SubmissionInput, SubmissionOutcome } from "./types";

/**
 * Content Rewards submission via Playwright form-fill (no official submission
 * API is available). Opens the campaign page in the persistent authenticated
 * context, locates the "submit post / add link" form, fills the post URL, and
 * submits.
 *
 * This adapter performs the actual submit; the service layer only calls it
 * AFTER the required human confirmation during the MVP, so nothing is submitted
 * without sign-off.
 */
export class ContentRewardsSubmissionAdapter implements SubmissionAdapter {
  readonly name = "content-rewards-form";
  readonly official = false;

  async submit(input: SubmissionInput): Promise<SubmissionOutcome> {
    await assertSafeUrl(input.campaignSourceUrl);

    return withPersistentContext(async (ctx) => {
      const page = await ctx.newPage();
      await page.goto(input.campaignSourceUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });

      // Locate a URL/link input within the submission form.
      const input$ = page
        .locator(
          "input[type='url'], input[name*='link' i], input[name*='url' i], input[placeholder*='link' i], input[placeholder*='url' i]",
        )
        .first();
      if ((await input$.count()) === 0) {
        return { submitted: false, note: "Submission form not found on campaign page" };
      }
      await input$.fill(input.postUrl);

      const submitBtn = page
        .locator("button[type='submit'], button:has-text('Submit'), button:has-text('Add')")
        .first();
      if ((await submitBtn.count()) === 0) {
        return { submitted: false, note: "Submit button not found" };
      }
      await submitBtn.click();
      await page.waitForTimeout(1500);

      logger.info({ campaign: input.campaignSourceUrl }, "Submission form submitted");
      return { submitted: true, note: "Submitted via Content Rewards form" };
    });
  }
}
