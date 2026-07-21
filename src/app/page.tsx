import { prisma } from "@/lib/db/prisma";
import { DiscoverButton } from "@/components/ActionButtons";

export const dynamic = "force-dynamic";

export default async function OverviewPage() {
  const [campaigns, needsReview, resources, failedJobs, rules] = await Promise.all([
    prisma.campaign.count(),
    prisma.campaign.count({ where: { status: "NEEDS_MANUAL_REVIEW" } }),
    prisma.campaignResource.count(),
    prisma.jobRun.count({ where: { status: "FAILED" } }),
    prisma.campaignRule.count(),
  ]).catch(() => [0, 0, 0, 0, 0] as const);

  const stats = [
    { l: "Campaigns", n: campaigns },
    { l: "Parsed rule sets", n: rules },
    { l: "Needs review", n: needsReview },
    { l: "Resource links", n: resources },
    { l: "Failed jobs", n: failedJobs },
  ];

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2>Overview</h2>
        <DiscoverButton />
      </div>
      <p className="muted">
        Phase 1 — campaign discovery, parsing, database and dashboard. Trigger a
        discovery run to fetch campaigns from Content Rewards and the Whop forum.
      </p>
      <div className="stat-grid">
        {stats.map((s) => (
          <div className="stat" key={s.l}>
            <div className="n">{s.n}</div>
            <div className="l">{s.l}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
