import { prisma } from "@/lib/db/prisma";
import { ClipScoresSchema } from "@/lib/schemas/media";

export const dynamic = "force-dynamic";

function score(value: unknown): string {
  const p = ClipScoresSchema.safeParse(value);
  if (!p.success) return "—";
  const s = p.data;
  return `${s.overall.toFixed(2)} (hook ${s.hookStrength.toFixed(2)}, emo ${s.emotionalIntensity.toFixed(2)})`;
}

export default async function CandidatesPage() {
  const candidates = await prisma.clipCandidate
    .findMany({
      orderBy: { createdAt: "desc" },
      take: 150,
      include: { sourceAsset: { include: { campaign: true } } },
    })
    .catch(() => []);

  return (
    <div>
      <h2>Clip candidates</h2>
      <div className="card">
        {candidates.length === 0 ? (
          <p className="muted">
            No clip candidates yet. Download a source asset and use &quot;Generate
            clips&quot;.
          </p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Campaign</th>
                <th>Range</th>
                <th>Length</th>
                <th>Status</th>
                <th>Score</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {candidates.map((c) => (
                <tr key={c.id}>
                  <td>
                    <a href={`/campaigns/${c.sourceAsset.campaignId}`}>
                      {c.sourceAsset.campaign.title ?? c.sourceAsset.campaign.externalId}
                    </a>
                  </td>
                  <td className="muted">
                    {c.startSec.toFixed(1)}–{c.endSec.toFixed(1)}s
                  </td>
                  <td>{(c.endSec - c.startSec).toFixed(1)}s</td>
                  <td>
                    <span className={`badge ${c.status === "CANDIDATE" || c.status === "APPROVED" ? "ok" : c.status === "REJECTED" ? "bad" : "warn"}`}>
                      {c.status}
                    </span>
                  </td>
                  <td>{score(c.scores)}</td>
                  <td className="muted">{c.rejectionReason ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
