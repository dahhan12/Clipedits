import { headers } from "next/headers";
import { prisma } from "@/lib/db/prisma";
import { actorFromHeaders, campaignVisibilityWhere } from "@/lib/db/workspaceScope";

export const dynamic = "force-dynamic";

function statusBadge(status: string) {
  const cls = status === "PUBLISHED" ? "ok" : status === "FAILED" || status === "SKIPPED" ? "bad" : "warn";
  return <span className={`badge ${cls}`}>{status}</span>;
}

export default async function PublicationsPage() {
  const actor = actorFromHeaders(await headers());
  const publications = await prisma.publication
    .findMany({
      where: { renderedClip: { candidate: { sourceAsset: { campaign: campaignVisibilityWhere(actor) } } } },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: {
        renderedClip: { include: { candidate: { include: { sourceAsset: { include: { campaign: true } } } } } },
        submission: true,
      },
    })
    .catch(() => []);

  return (
    <div>
      <h2>Publications</h2>
      <div className="card">
        {publications.length === 0 ? (
          <p className="muted">No publications yet. Publish a compliant clip from its preview page.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Campaign</th>
                <th>Platform</th>
                <th>Mode</th>
                <th>Status</th>
                <th>Post</th>
                <th>Submission</th>
              </tr>
            </thead>
            <tbody>
              {publications.map((p) => {
                const campaign = p.renderedClip.candidate.sourceAsset.campaign;
                return (
                  <tr key={p.id}>
                    <td>
                      <a href={`/clips/${p.renderedClipId}`}>{campaign.title ?? campaign.externalId}</a>
                    </td>
                    <td>{p.platform}</td>
                    <td>{p.mode}</td>
                    <td>{statusBadge(p.status)}</td>
                    <td className="muted">
                      {p.postUrl ? (
                        <a href={p.postUrl} target="_blank" rel="noreferrer">
                          {p.externalPostId ?? "link"}
                        </a>
                      ) : (
                        p.failureReason?.slice(0, 40) ?? "—"
                      )}
                    </td>
                    <td className="muted">{p.submission ? p.submission.status : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
