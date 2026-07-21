import { prisma } from "@/lib/db/prisma";
import { ConfirmSubmissionButton } from "@/components/ActionButtons";

export const dynamic = "force-dynamic";

function statusBadge(status: string) {
  const cls =
    status === "SUBMITTED" || status === "APPROVED"
      ? "ok"
      : status === "FAILED" || status === "REJECTED"
        ? "bad"
        : "warn";
  return <span className={`badge ${cls}`}>{status}</span>;
}

export default async function SubmissionsPage() {
  const submissions = await prisma.campaignSubmission
    .findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { campaign: true, publication: true },
    })
    .catch(() => []);

  return (
    <div>
      <h2>Campaign submissions</h2>
      <p className="muted">
        During the MVP, submissions await an explicit confirmation before the final on-site submit.
      </p>
      <div className="card">
        {submissions.length === 0 ? (
          <p className="muted">No submissions yet. Publish a clip to prepare its submission.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Campaign</th>
                <th>Platform</th>
                <th>Status</th>
                <th>Post</th>
                <th>Qual. views</th>
                <th>Est. earnings</th>
                <th>Payout</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {submissions.map((s) => (
                <tr key={s.id}>
                  <td>
                    <a href={`/campaigns/${s.campaignId}`}>{s.campaign.title ?? s.campaign.externalId}</a>
                  </td>
                  <td>{s.publication.platform}</td>
                  <td>{statusBadge(s.status)}</td>
                  <td className="muted">
                    {s.publication.postUrl ? (
                      <a href={s.publication.postUrl} target="_blank" rel="noreferrer">
                        link
                      </a>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td>{s.qualifiedViews ?? "—"}</td>
                  <td>{s.estimatedEarnings != null ? `$${s.estimatedEarnings.toFixed(2)}` : "—"}</td>
                  <td>
                    <span className={`badge ${s.payoutStatus === "PAID" ? "ok" : "warn"}`}>{s.payoutStatus}</span>
                  </td>
                  <td>{s.status === "AWAITING_CONFIRMATION" && <ConfirmSubmissionButton submissionId={s.id} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
