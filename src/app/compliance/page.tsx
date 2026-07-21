import { prisma } from "@/lib/db/prisma";

export const dynamic = "force-dynamic";

function badge(outcome: string) {
  const cls = outcome === "PASS" ? "ok" : outcome === "FAIL" ? "bad" : "warn";
  return <span className={`badge ${cls}`}>{outcome}</span>;
}

export default async function CompliancePage() {
  const clips = await prisma.renderedClip
    .findMany({
      orderBy: { createdAt: "desc" },
      take: 40,
      include: {
        compliance: { orderBy: { createdAt: "asc" } },
        candidate: { include: { sourceAsset: { include: { campaign: true } } } },
      },
    })
    .catch(() => []);

  return (
    <div>
      <h2>Compliance results</h2>
      {clips.length === 0 ? (
        <div className="card">
          <p className="muted">No rendered clips yet. Approve a candidate to render and evaluate it.</p>
        </div>
      ) : (
        clips.map((clip) => {
          const overall = clip.compliance.some((r) => r.outcome === "FAIL")
            ? "FAIL"
            : clip.compliance.some((r) => r.outcome === "REVIEW")
              ? "REVIEW"
              : "PASS";
          const campaign = clip.candidate.sourceAsset.campaign;
          return (
            <div className="card" key={clip.id}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <h3 style={{ margin: 0 }}>
                  <a href={`/clips/${clip.id}`}>
                    {campaign.title ?? campaign.externalId}
                  </a>{" "}
                  <span className="muted">
                    · {clip.candidate.startSec.toFixed(1)}–{clip.candidate.endSec.toFixed(1)}s · {clip.width}x{clip.height}
                  </span>
                </h3>
                {badge(overall)}
              </div>
              <table style={{ marginTop: 10 }}>
                <thead>
                  <tr>
                    <th>Check</th>
                    <th>Result</th>
                    <th>Reason</th>
                    <th>Kind</th>
                  </tr>
                </thead>
                <tbody>
                  {clip.compliance.map((r) => (
                    <tr key={r.id}>
                      <td>{r.check}</td>
                      <td>{badge(r.outcome)}</td>
                      <td className="muted">{r.reason}</td>
                      <td className="muted">{r.deterministic ? "deterministic" : "semantic"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })
      )}
    </div>
  );
}
