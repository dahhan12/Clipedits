import { headers } from "next/headers";
import { prisma } from "@/lib/db/prisma";
import { actorFromHeaders, campaignVisibilityWhere } from "@/lib/db/workspaceScope";

export const dynamic = "force-dynamic";

export default async function EarningsPage() {
  const actor = actorFromHeaders(await headers());
  const submissions = await prisma.campaignSubmission
    .findMany({ where: { campaign: campaignVisibilityWhere(actor) }, include: { campaign: true } })
    .catch(() => []);

  const byCampaign = new Map<
    string,
    { title: string; earnings: number; confirmed: number; views: number; count: number }
  >();
  for (const s of submissions) {
    const key = s.campaignId;
    const cur = byCampaign.get(key) ?? {
      title: s.campaign.title ?? s.campaign.externalId,
      earnings: 0,
      confirmed: 0,
      views: 0,
      count: 0,
    };
    cur.earnings += s.estimatedEarnings ?? 0;
    cur.confirmed += s.confirmedEarnings ?? 0;
    cur.views += s.qualifiedViews ?? 0;
    cur.count += 1;
    byCampaign.set(key, cur);
  }

  const rows = [...byCampaign.entries()].sort((a, b) => b[1].earnings - a[1].earnings);
  const total = rows.reduce((acc, [, v]) => acc + v.earnings, 0);
  const totalConfirmed = rows.reduce((acc, [, v]) => acc + v.confirmed, 0);

  return (
    <div>
      <h2>Earnings estimates</h2>
      <div className="stat-grid" style={{ marginBottom: 16 }}>
        <div className="stat">
          <div className="n">${total.toFixed(2)}</div>
          <div className="l">Total estimated earnings</div>
        </div>
        <div className="stat">
          <div className="n">${totalConfirmed.toFixed(2)}</div>
          <div className="l">Total confirmed earnings</div>
        </div>
        <div className="stat">
          <div className="n">{rows.length}</div>
          <div className="l">Campaigns with submissions</div>
        </div>
      </div>
      <div className="card">
        {rows.length === 0 ? (
          <p className="muted">No earnings estimates yet. Estimates appear once submissions are tracked.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Campaign</th>
                <th>Submissions</th>
                <th>Qualified views</th>
                <th>Estimated</th>
                <th>Confirmed</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(([id, v]) => (
                <tr key={id}>
                  <td>
                    <a href={`/campaigns/${id}`}>{v.title}</a>
                  </td>
                  <td>{v.count}</td>
                  <td>{v.views || "—"}</td>
                  <td>${v.earnings.toFixed(2)}</td>
                  <td>{v.confirmed ? `$${v.confirmed.toFixed(2)}` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
