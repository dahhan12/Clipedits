import type { FixtureExpectation } from "./scoring";

/**
 * Versioned campaign-parsing evaluation set (v1). Sanitised/synthetic campaign
 * content spanning: clean, ambiguous, contradictory, missing-field, revised,
 * pasted-text, and screenshot/PDF-like inputs. Each fixture's `expectation`
 * encodes the ground-truth a CORRECT extraction should produce, including which
 * critical fields are deliberately omitted (`missing`) so hallucination is
 * measurable, and whether a contradiction must be flagged.
 *
 * Keep this file append-only per version; bump EVAL_SET_VERSION on changes so
 * results are comparable over time.
 */

export const EVAL_SET_VERSION = "1.0.0";

export interface EvalFixture {
  id: string;
  category: "clean" | "ambiguous" | "contradictory" | "missing" | "revised" | "text" | "document";
  inputText: string;
  expectation: FixtureExpectation;
}

export const FIXTURES: EvalFixture[] = [
  {
    id: "clean-tiktok-basic",
    category: "clean",
    inputText:
      "Campaign: Repost our launch clips to TikTok. Clips must be 15-60 seconds, vertical 9:16. Include #ad and #NovaLaunch and mention @novabrand. Total budget $10,000, CPM $2.00 on TikTok. Max 5 posts per creator. Submission deadline 2026-12-01. Submit your post URL on the campaign page.",
    expectation: {
      fields: {
        supportedPlatforms: ["TIKTOK"],
        durationMin: 15,
        durationMax: 60,
        requiredAspectRatio: "9:16",
        requiredHashtags: ["#ad", "#NovaLaunch"],
        requiredMentions: ["@novabrand"],
        budgetTotal: 10000,
        maxPosts: 5,
        deadline: "2026-12-01",
        submissionMethod: "post URL on the campaign page",
      },
    },
  },
  {
    id: "clean-multi-platform",
    category: "clean",
    inputText:
      "Post to TikTok, Instagram Reels and YouTube Shorts. 20-45s, 9:16. Must include #SponsoredByAcme. No profanity. Budget $5000. Minimum 10,000 views to qualify. Deadline 2026-10-15.",
    expectation: {
      fields: {
        supportedPlatforms: ["TIKTOK", "INSTAGRAM_REELS", "YOUTUBE_SHORTS"],
        durationMin: 20,
        durationMax: 45,
        requiredAspectRatio: "9:16",
        requiredHashtags: ["#SponsoredByAcme"],
        prohibitedContent: ["profanity"],
        budgetTotal: 5000,
        minViews: 10000,
        deadline: "2026-10-15",
      },
      missing: ["requiredMentions", "maxPosts"],
    },
  },
  {
    id: "clean-youtube-audio",
    category: "clean",
    inputText:
      "YouTube Shorts only. Use the official campaign audio 'Nova Theme'. 30-60 seconds. Include #Shorts and #NovaMusic. Deadline 2026-09-30. Max 3 posts.",
    expectation: {
      fields: {
        supportedPlatforms: ["YOUTUBE_SHORTS"],
        durationMin: 30,
        durationMax: 60,
        requiredAudio: ["Nova Theme"],
        requiredHashtags: ["#Shorts", "#NovaMusic"],
        deadline: "2026-09-30",
        maxPosts: 3,
      },
    },
  },
  {
    id: "clean-overlay-logo",
    category: "clean",
    inputText:
      "Instagram Reels. Add the Acme logo overlay top-right for the full clip. 9:16, 15-30s. Include caption 'Sponsored by Acme'. Deadline 2026-11-20.",
    expectation: {
      fields: {
        supportedPlatforms: ["INSTAGRAM_REELS"],
        requiredOverlaysAndLogos: ["Acme logo"],
        requiredAspectRatio: "9:16",
        durationMin: 15,
        durationMax: 30,
        requiredCaptions: ["Sponsored by Acme"],
        deadline: "2026-11-20",
      },
    },
  },
  {
    id: "clean-source-only",
    category: "clean",
    inputText:
      "TikTok. You may only use the provided source footage — no external clips. 15-60s. #ad required. Budget $8000. Deadline 2026-08-01.",
    expectation: {
      fields: {
        supportedPlatforms: ["TIKTOK"],
        sourceContentOnly: true,
        durationMin: 15,
        durationMax: 60,
        requiredHashtags: ["#ad"],
        budgetTotal: 8000,
        deadline: "2026-08-01",
      },
    },
  },
  {
    id: "ambiguous-duration",
    category: "ambiguous",
    inputText:
      "TikTok clips should be short — ideally under a minute but longer is sometimes fine. Include #ad. Deadline 2026-12-31.",
    expectation: {
      fields: {
        supportedPlatforms: ["TIKTOK"],
        requiredHashtags: ["#ad"],
        deadline: "2026-12-31",
      },
      hasContradiction: true,
      missing: ["durationMin", "durationMax"],
    },
  },
  {
    id: "ambiguous-platform",
    category: "ambiguous",
    inputText:
      "Post it wherever your audience is — social media works best. Keep it vertical. #brand. Deadline 2026-07-15.",
    expectation: {
      fields: {
        requiredAspectRatio: "9:16",
        requiredHashtags: ["#brand"],
        deadline: "2026-07-15",
      },
      hasContradiction: true,
      missing: ["supportedPlatforms"],
    },
  },
  {
    id: "contradictory-hashtags",
    category: "contradictory",
    inputText:
      "TikTok. Include #ad. Do NOT include any hashtags in your caption. 15-30s, 9:16. Deadline 2026-10-01.",
    expectation: {
      fields: {
        supportedPlatforms: ["TIKTOK"],
        durationMin: 15,
        durationMax: 30,
        requiredAspectRatio: "9:16",
        deadline: "2026-10-01",
      },
      hasContradiction: true,
    },
  },
  {
    id: "contradictory-duration",
    category: "contradictory",
    inputText:
      "Clips must be at least 60 seconds. Clips must be no longer than 30 seconds. TikTok. #ad. Deadline 2026-09-01.",
    expectation: {
      fields: {
        supportedPlatforms: ["TIKTOK"],
        requiredHashtags: ["#ad"],
        deadline: "2026-09-01",
      },
      hasContradiction: true,
    },
  },
  {
    id: "contradictory-platform-audio",
    category: "contradictory",
    inputText:
      "YouTube Shorts only. You must use TikTok's official in-app sound. 15-60s. #Shorts. Deadline 2026-11-01.",
    expectation: {
      fields: {
        supportedPlatforms: ["YOUTUBE_SHORTS"],
        durationMin: 15,
        durationMax: 60,
        requiredHashtags: ["#Shorts"],
        deadline: "2026-11-01",
      },
      hasContradiction: true,
    },
  },
  {
    id: "missing-deadline",
    category: "missing",
    inputText:
      "TikTok. 15-30s, 9:16. Include #ad and mention @acme. Budget $3000.",
    expectation: {
      fields: {
        supportedPlatforms: ["TIKTOK"],
        durationMin: 15,
        durationMax: 30,
        requiredAspectRatio: "9:16",
        requiredHashtags: ["#ad"],
        requiredMentions: ["@acme"],
        budgetTotal: 3000,
      },
      missing: ["deadline", "maxPosts", "submissionMethod"],
    },
  },
  {
    id: "missing-platform-and-duration",
    category: "missing",
    inputText: "Include #BrandDeal and the tagline 'Made with Acme'. Deadline 2026-10-20.",
    expectation: {
      fields: {
        requiredHashtags: ["#BrandDeal"],
        requiredCaptions: ["Made with Acme"],
        deadline: "2026-10-20",
      },
      missing: ["supportedPlatforms", "durationMin", "durationMax", "requiredAspectRatio"],
    },
  },
  {
    id: "missing-most-fields",
    category: "missing",
    inputText: "Repurpose our podcast into short clips. More details to follow.",
    expectation: {
      fields: {},
      missing: ["supportedPlatforms", "deadline", "durationMin", "durationMax", "requiredAspectRatio", "maxPosts"],
    },
  },
  {
    id: "revised-budget-down",
    category: "revised",
    inputText:
      "[UPDATED] TikTok. Budget reduced to $2000 (was $10,000). Remaining budget $500. 15-45s, 9:16. #ad. Deadline extended to 2027-01-15. Max 2 posts.",
    expectation: {
      fields: {
        supportedPlatforms: ["TIKTOK"],
        budgetTotal: 2000,
        budgetRemaining: 500,
        durationMin: 15,
        durationMax: 45,
        requiredAspectRatio: "9:16",
        requiredHashtags: ["#ad"],
        deadline: "2027-01-15",
        maxPosts: 2,
      },
    },
  },
  {
    id: "revised-closed",
    category: "revised",
    inputText:
      "This campaign is now CLOSED. No further submissions accepted. It was TikTok, 15-60s, #ad.",
    expectation: {
      fields: {
        status: "CLOSED",
        supportedPlatforms: ["TIKTOK"],
      },
    },
  },
  {
    id: "text-payout-range",
    category: "text",
    inputText:
      "TikTok + Instagram Reels. Payout $25 minimum, up to $500 per post. CPM $3. 20-40s, 9:16. #ad #promo. Deadline 2026-12-10. Max 4 posts.",
    expectation: {
      fields: {
        supportedPlatforms: ["TIKTOK", "INSTAGRAM_REELS"],
        minPayout: 25,
        maxPayout: 500,
        durationMin: 20,
        durationMax: 40,
        requiredAspectRatio: "9:16",
        requiredHashtags: ["#ad", "#promo"],
        deadline: "2026-12-10",
        maxPosts: 4,
      },
    },
  },
  {
    id: "text-prohibited",
    category: "text",
    inputText:
      "TikTok. No profanity, no competitor mentions, no political content. 15-30s. #ad. Deadline 2026-09-15.",
    expectation: {
      fields: {
        supportedPlatforms: ["TIKTOK"],
        prohibitedContent: ["profanity", "competitor mentions", "political content"],
        durationMin: 15,
        durationMax: 30,
        requiredHashtags: ["#ad"],
        deadline: "2026-09-15",
      },
    },
  },
  {
    id: "text-mentions-multi",
    category: "text",
    inputText:
      "Mention both @acme and @acmeshop. TikTok, 15-45s, 9:16. #AcmePartner. Deadline 2026-11-05.",
    expectation: {
      fields: {
        requiredMentions: ["@acme", "@acmeshop"],
        supportedPlatforms: ["TIKTOK"],
        durationMin: 15,
        durationMax: 45,
        requiredAspectRatio: "9:16",
        requiredHashtags: ["#AcmePartner"],
        deadline: "2026-11-05",
      },
    },
  },
  {
    id: "document-brief",
    category: "document",
    inputText:
      "CAMPAIGN BRIEF\\nPlatform: YouTube Shorts\\nDuration: 30 to 60 seconds\\nAspect ratio: 9:16\\nRequired hashtags: #Shorts, #AcmeReview\\nRequired mention: @acme\\nMax posts per creator: 3\\nSubmission: paste the public URL into the portal\\nDeadline: 2026-10-31",
    expectation: {
      fields: {
        supportedPlatforms: ["YOUTUBE_SHORTS"],
        durationMin: 30,
        durationMax: 60,
        requiredAspectRatio: "9:16",
        requiredHashtags: ["#Shorts", "#AcmeReview"],
        requiredMentions: ["@acme"],
        maxPosts: 3,
        submissionMethod: "paste the public URL into the portal",
        deadline: "2026-10-31",
      },
    },
  },
  {
    id: "document-table",
    category: "document",
    inputText:
      "Field | Value\\nPlatforms | TikTok\\nLength | 15-60s\\nRatio | 9:16\\nHashtags | #ad\\nBudget | $12,000\\nCPM | $2.50\\nDeadline | 2026-12-20",
    expectation: {
      fields: {
        supportedPlatforms: ["TIKTOK"],
        durationMin: 15,
        durationMax: 60,
        requiredAspectRatio: "9:16",
        requiredHashtags: ["#ad"],
        budgetTotal: 12000,
        deadline: "2026-12-20",
      },
    },
  },
  {
    id: "clean-instagram-caption",
    category: "clean",
    inputText:
      "Instagram Reels. Caption must include 'Paid partnership with Acme'. 9:16, 20-40s. #ad. Deadline 2026-11-11. Max 5 posts.",
    expectation: {
      fields: {
        supportedPlatforms: ["INSTAGRAM_REELS"],
        requiredCaptions: ["Paid partnership with Acme"],
        requiredAspectRatio: "9:16",
        durationMin: 20,
        durationMax: 40,
        requiredHashtags: ["#ad"],
        deadline: "2026-11-11",
        maxPosts: 5,
      },
    },
  },
  {
    id: "ambiguous-budget",
    category: "ambiguous",
    inputText:
      "TikTok. Generous budget, plenty to go around. 15-30s, 9:16. #ad. Deadline 2026-10-05.",
    expectation: {
      fields: {
        supportedPlatforms: ["TIKTOK"],
        durationMin: 15,
        durationMax: 30,
        requiredAspectRatio: "9:16",
        requiredHashtags: ["#ad"],
        deadline: "2026-10-05",
      },
      missing: ["budgetTotal", "maxPosts"],
    },
  },
  {
    id: "text-min-views",
    category: "text",
    inputText:
      "TikTok. Posts qualify at 25,000 views. 15-60s, 9:16. #ad #viral. Deadline 2026-12-05.",
    expectation: {
      fields: {
        supportedPlatforms: ["TIKTOK"],
        minViews: 25000,
        durationMin: 15,
        durationMax: 60,
        requiredAspectRatio: "9:16",
        requiredHashtags: ["#ad", "#viral"],
        deadline: "2026-12-05",
      },
    },
  },
  {
    id: "contradictory-status",
    category: "contradictory",
    inputText:
      "Campaign is ACTIVE and accepting posts. Note: submissions are closed. TikTok, #ad, 15-30s.",
    expectation: {
      fields: {
        supportedPlatforms: ["TIKTOK"],
        requiredHashtags: ["#ad"],
        durationMin: 15,
        durationMax: 30,
      },
      hasContradiction: true,
    },
  },
  {
    id: "clean-full-spec",
    category: "clean",
    inputText:
      "TikTok and Instagram Reels. 15-45 seconds, 9:16 vertical. Include #ad and #AcmeSummer, mention @acme. Add the Acme logo overlay. No profanity, no competitor brands. Budget $20,000, remaining $18,000. CPM $2 TikTok. Payout min $50, max $400. Min 10,000 qualified views. Max 6 posts. Deadline 2026-12-31. Submit the public post URL via the campaign form.",
    expectation: {
      fields: {
        supportedPlatforms: ["TIKTOK", "INSTAGRAM_REELS"],
        durationMin: 15,
        durationMax: 45,
        requiredAspectRatio: "9:16",
        requiredHashtags: ["#ad", "#AcmeSummer"],
        requiredMentions: ["@acme"],
        requiredOverlaysAndLogos: ["Acme logo"],
        prohibitedContent: ["profanity", "competitor brands"],
        budgetTotal: 20000,
        budgetRemaining: 18000,
        minPayout: 50,
        maxPayout: 400,
        minViews: 10000,
        maxPosts: 6,
        deadline: "2026-12-31",
        submissionMethod: "public post URL via the campaign form",
      },
    },
  },
  {
    id: "missing-aspect-ratio",
    category: "missing",
    inputText:
      "TikTok. 15-60 seconds. Include #ad. Budget $4000. Deadline 2026-10-25. Max 3 posts.",
    expectation: {
      fields: {
        supportedPlatforms: ["TIKTOK"],
        durationMin: 15,
        durationMax: 60,
        requiredHashtags: ["#ad"],
        budgetTotal: 4000,
        deadline: "2026-10-25",
        maxPosts: 3,
      },
      missing: ["requiredAspectRatio", "requiredMentions"],
    },
  },
];
