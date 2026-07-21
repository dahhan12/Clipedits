import { headers } from "next/headers";
import { prisma } from "@/lib/db/prisma";
import { ManualCampaignForm } from "@/components/ManualCampaignForm";
import { actorFromHeaders, campaignVisibilityWhere } from "@/lib/db/workspaceScope";

export const dynamic = "force-dynamic";

function statusBadge(status: string) {
  const cls =
    status === "PARSED" ? "ok" : status === "NEEDS_MANUAL_REVIEW" || status === "ERROR" ? "bad" : "warn";
  return <span className={`badge ${cls}`}>{status}</span>;
}

export default async function CampaignsPage() {
  const actor = actorFromHeaders(await headers());
  const campaigns = await prisma.campaign
    .findMany({
      where: campaignVisibilityWhere(actor),
      orderBy: { discoveredAt: "desc" },
      take: 100,
      include: { _count: { select: { rules: true, resources: true } } },
    })
    .catch(() => []);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2>New campaigns</h2>
        <ManualCampaignForm />
      </div>
      {campaigns.length === 0 ? (
        <div className="card">
          <p className="muted">
            No campaigns yet. Run discovery from the Overview page (requires the
            discovery worker and a reachable database).
          </p>
        </div>
      ) : (
        <div className="card">
          <table>
            <thead>
              <tr>
                <th>Campaign</th>
                <th>Source</th>
                <th>Status</th>
                <th>Rules</th>
                <th>Resources</th>
                <th>Discovered</th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map((c) => (
                <tr key={c.id}>
                  <td>
                    <a href={`/campaigns/${c.id}`}>{c.title ?? c.externalId}</a>
                  </td>
                  <td className="muted">{c.source}</td>
                  <td>{statusBadge(c.status)}</td>
                  <td>{c._count.rules}</td>
                  <td>{c._count.resources}</td>
                  <td className="muted">{c.discoveredAt.toISOString().slice(0, 10)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
