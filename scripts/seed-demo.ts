/**
 * Seed a single, clearly-labelled DEMO campaign so the dashboard has data to
 * explore without live scraping, ffmpeg, or platform credentials. This is
 * demo data — not a real campaign. Run: `npm run seed:demo`.
 */
import { prisma } from "@/lib/db/prisma";
import { CampaignRulesSchema } from "@/lib/schemas/campaign";
import { TranscriptSchema, ClipScoresSchema } from "@/lib/schemas/media";
import { sha256Hex } from "@/lib/security/crypto";

async function main() {
  const sourceUrl = "https://www.contentrewards.com/discover/demo-001";
  const campaign = await prisma.campaign.upsert({
    where: { source_externalId: { source: "CONTENT_REWARDS", externalId: "demo-001" } },
    create: {
      source: "CONTENT_REWARDS",
      externalId: "demo-001",
      title: "[DEMO] Creator Clips Challenge",
      sourceUrl,
      status: "PARSED",
      lastPageHash: sha256Hex("demo-001-v1"),
    },
    update: { status: "PARSED" },
  });

  await prisma.campaignRevision.upsert({
    where: { campaignId_pageHash: { campaignId: campaign.id, pageHash: sha256Hex("demo-001-v1") } },
    create: {
      campaignId: campaign.id,
      pageHash: sha256Hex("demo-001-v1"),
      budgetTotal: 10000,
      budgetRemaining: 6500,
      status: "ACTIVE",
    },
    update: {},
  });

  const rules = CampaignRulesSchema.parse({
    campaignId: "demo-001",
    title: "[DEMO] Creator Clips Challenge",
    sourceUrl,
    status: "ACTIVE",
    budgetTotal: 10000,
    budgetRemaining: 6500,
    cpmByPlatform: { TIKTOK: 2.5, INSTAGRAM_REELS: 2.0, YOUTUBE_SHORTS: 1.5 },
    supportedPlatforms: ["TIKTOK", "INSTAGRAM_REELS", "YOUTUBE_SHORTS"],
    minPayout: 25,
    maxPayout: 500,
    minViews: 10000,
    maxPosts: 5,
    deadline: "2026-12-31T23:59:59+00:00",
    accountEligibility: ["Public account", "1000+ followers"],
    requiredVideoDurationSec: { min: 15, max: 60 },
    requiredAspectRatio: "9:16",
    requiredHashtags: ["#CreatorClips", "#ad"],
    requiredMentions: ["@brandhandle"],
    requiredCaptions: ["Sponsored by BrandCo"],
    prohibitedContent: ["profanity", "competitor mentions"],
    submissionInstructions: "Paste your post URL into the campaign submission form.",
    resourceLinks: [
      { url: "https://drive.google.com/file/d/DEMOFILEID/view", label: "B-roll pack", permittedForDownload: true },
    ],
    uncertainties: [],
    confidence: 0.88,
    evidence: [{ field: "requiredHashtags", excerpt: "Posts must include #CreatorClips and #ad", sourceUrl }],
  });

  await prisma.campaignRule.create({
    data: { campaignId: campaign.id, status: "PARSED", rules, confidence: rules.confidence, uncertainties: [], model: "demo" },
  });

  await prisma.campaignResource.upsert({
    where: { campaignId_url: { campaignId: campaign.id, url: rules.resourceLinks[0]!.url } },
    create: { campaignId: campaign.id, url: rules.resourceLinks[0]!.url, kind: "GOOGLE_DRIVE_FILE", permitted: true, status: "DOWNLOADED", notes: "B-roll pack" },
    update: {},
  });

  const transcript = TranscriptSchema.parse({
    language: "en",
    durationSec: 120,
    provider: "demo",
    segments: [
      { startSec: 0, endSec: 15, text: "Here's the one tip that changed everything for my content." },
      { startSec: 15, endSec: 40, text: "Most people get this completely wrong, so let me show you." },
      { startSec: 40, endSec: 75, text: "Step by step, this is exactly how it works in practice." },
      { startSec: 75, endSec: 120, text: "And that's how you get results fast. Follow for more." },
    ],
  });

  const asset = await prisma.sourceAsset.upsert({
    where: { campaignId_checksum: { campaignId: campaign.id, checksum: sha256Hex("demo-asset-1") } },
    create: {
      campaignId: campaign.id,
      originalSource: "https://drive.google.com/file/d/DEMOFILEID/view",
      storageKey: `campaigns/${campaign.id}/resources/demo/broll.mp4`,
      checksum: sha256Hex("demo-asset-1"),
      mimeType: "video/mp4",
      bytes: 48_500_000,
      durationSec: 120,
      status: "READY",
      downloadedAt: new Date(),
      transcript,
    },
    update: { transcript, status: "READY" },
  });

  const ranges = [
    { startSec: 0, endSec: 15, overall: 0.82, hook: 0.9 },
    { startSec: 15, endSec: 40, overall: 0.61, hook: 0.55 },
    { startSec: 40, endSec: 75, overall: 0.38, hook: 0.3 },
  ];
  for (const r of ranges) {
    const scores = ClipScoresSchema.parse({
      hookStrength: r.hook,
      clarity: 0.7,
      emotionalIntensity: 0.6,
      campaignRelevance: 0.65,
      standaloneValue: 0.7,
      overall: r.overall,
      rationale: "demo scoring",
    });
    await prisma.clipCandidate.create({
      data: {
        sourceAssetId: asset.id,
        startSec: r.startSec,
        endSec: r.endSec,
        status: r.overall < 0.45 ? "REJECTED" : "CANDIDATE",
        rejectionReason: r.overall < 0.45 ? `overall score ${r.overall} below 0.45` : null,
        scores,
      },
    });
  }

  console.log(`Seeded DEMO campaign ${campaign.id} with rules, 1 resource, 1 asset, ${ranges.length} clip candidates.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
