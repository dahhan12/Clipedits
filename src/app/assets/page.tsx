import { headers } from "next/headers";
import { prisma } from "@/lib/db/prisma";
import { actorFromHeaders, campaignVisibilityWhere } from "@/lib/db/workspaceScope";
import { GenerateClipsButton } from "@/components/ActionButtons";

export const dynamic = "force-dynamic";

function fmtBytes(n: number | null): string {
  if (!n) return "—";
  const u = ["B", "KB", "MB", "GB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(1)} ${u[i]}`;
}

export default async function AssetsPage() {
  const actor = actorFromHeaders(await headers());
  const assets = await prisma.sourceAsset
    .findMany({
      where: { campaign: campaignVisibilityWhere(actor) },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { campaign: true, _count: { select: { candidates: true } } },
    })
    .catch(() => []);

  return (
    <div>
      <h2>Source assets</h2>
      <div className="card">
        {assets.length === 0 ? (
          <p className="muted">
            No downloaded assets yet. Approve a campaign&apos;s resources and use
            &quot;Download resources&quot; on its page.
          </p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Campaign</th>
                <th>Source</th>
                <th>Size</th>
                <th>Duration</th>
                <th>Status</th>
                <th>Candidates</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {assets.map((a) => (
                <tr key={a.id}>
                  <td>
                    <a href={`/campaigns/${a.campaignId}`}>
                      {a.campaign.title ?? a.campaign.externalId}
                    </a>
                  </td>
                  <td className="muted" title={a.originalSource}>
                    {a.originalSource.slice(0, 40)}
                  </td>
                  <td>{fmtBytes(a.bytes)}</td>
                  <td>{a.durationSec ? `${a.durationSec.toFixed(0)}s` : "—"}</td>
                  <td>
                    <span className={`badge ${a.status === "READY" ? "ok" : a.status === "FAILED" ? "bad" : "warn"}`}>
                      {a.status}
                    </span>
                  </td>
                  <td>{a._count.candidates}</td>
                  <td>
                    <GenerateClipsButton assetId={a.id} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
