import { prisma } from "@/lib/db/prisma";
import { ClipScoresSchema } from "@/lib/schemas/media";
import { ApproveButton, RejectButton, RegenerateButton } from "@/components/ActionButtons";

export const dynamic = "force-dynamic";

export default async function ApprovalQueuePage() {
  const candidates = await prisma.clipCandidate
    .findMany({
      where: { status: "CANDIDATE" },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { sourceAsset: { include: { campaign: true } } },
    })
    .catch(() => []);

  return (
    <div>
      <h2>Approval queue</h2>
      <p className="muted">
        Approving renders the clip (9:16 H.264/AAC) and runs compliance automatically.
      </p>
      <div className="card">
        {candidates.length === 0 ? (
          <p className="muted">No candidates awaiting approval.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Campaign</th>
                <th>Range</th>
                <th>Overall</th>
                <th>Hook</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {candidates.map((c) => {
                const s = ClipScoresSchema.safeParse(c.scores);
                return (
                  <tr key={c.id}>
                    <td>
                      <a href={`/campaigns/${c.sourceAsset.campaignId}`}>
                        {c.sourceAsset.campaign.title ?? c.sourceAsset.campaign.externalId}
                      </a>
                    </td>
                    <td className="muted">
                      {c.startSec.toFixed(1)}–{c.endSec.toFixed(1)}s ({(c.endSec - c.startSec).toFixed(0)}s)
                    </td>
                    <td>{s.success ? s.data.overall.toFixed(2) : "—"}</td>
                    <td>{s.success ? s.data.hookStrength.toFixed(2) : "—"}</td>
                    <td>
                      <span style={{ display: "flex", gap: 6 }}>
                        <ApproveButton candidateId={c.id} />
                        <RejectButton candidateId={c.id} />
                        <RegenerateButton candidateId={c.id} />
                      </span>
                    </td>
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
