import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { prisma } from "@/lib/db/prisma";
import { actorFromHeaders, assertCampaignAccess, WorkspaceForbiddenError } from "@/lib/db/workspaceScope";
import { ReparseButton, DownloadResourcesButton } from "@/components/ActionButtons";
import { RuleEditor } from "@/components/RuleEditor";
import { CampaignRulesSchema } from "@/lib/schemas/campaign";
import { scoreCampaign, shouldProcess } from "@/services/scoring/profitability";

export const dynamic = "force-dynamic";

export default async function CampaignDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  try {
    await assertCampaignAccess(id, actorFromHeaders(await headers()));
  } catch (err) {
    if (err instanceof WorkspaceForbiddenError) notFound();
    throw err;
  }
  const campaign = await prisma.campaign
    .findUnique({
      where: { id },
      include: {
        rules: { orderBy: { createdAt: "desc" }, take: 1 },
        resources: true,
        revisions: { orderBy: { capturedAt: "desc" }, take: 5 },
      },
    })
    .catch(() => null);

  if (!campaign) notFound();

  const latestRule = campaign.rules[0];
  const parsed = latestRule ? CampaignRulesSchema.safeParse(latestRule.rules) : null;
  const rules = parsed?.success ? parsed.data : null;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2>{campaign.title ?? campaign.externalId}</h2>
        <span style={{ display: "flex", gap: 8 }}>
          <DownloadResourcesButton campaignId={campaign.id} />
          <ReparseButton campaignId={campaign.id} />
        </span>
      </div>
      <p className="muted">
        <a href={campaign.sourceUrl} target="_blank" rel="noreferrer">
          {campaign.sourceUrl}
        </a>{" "}
        · {campaign.source} · <span className="badge">{campaign.status}</span>
      </p>

      {!rules ? (
        <div className="card">
          <p className="muted">Not parsed yet.</p>
        </div>
      ) : (
        <>
          <div className="card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3 style={{ margin: 0 }}>
                Rules {latestRule && <span className="muted">· confidence {rules.confidence.toFixed(2)}</span>}
              </h3>
              <a className="btn secondary" href={`/campaigns/${campaign.id}/revisions`}>
                Revisions
              </a>
            </div>
            <table style={{ marginTop: 10 }}>
              <tbody>
                <Row k="Status" v={rules.status} />
                <Row k="Budget (total / remaining)" v={`${rules.budgetTotal ?? "—"} / ${rules.budgetRemaining ?? "—"}`} />
                <Row k="Supported platforms" v={rules.supportedPlatforms.join(", ") || "—"} />
                <Row k="Payout (min / max)" v={`${rules.minPayout ?? "—"} / ${rules.maxPayout ?? "—"}`} />
                <Row k="Min views" v={rules.minViews} />
                <Row k="Max posts" v={rules.maxPosts} />
                <Row k="Deadline" v={rules.deadline} />
                <Row k="Aspect ratio" v={rules.requiredAspectRatio} />
                <Row
                  k="Duration (s)"
                  v={
                    rules.requiredVideoDurationSec
                      ? `${rules.requiredVideoDurationSec.min ?? "—"}–${rules.requiredVideoDurationSec.max ?? "—"}`
                      : "—"
                  }
                />
                <Row k="Required hashtags" v={rules.requiredHashtags.join(", ") || "—"} />
                <Row k="Required mentions" v={rules.requiredMentions.join(", ") || "—"} />
                <Row k="Prohibited content" v={rules.prohibitedContent.join(", ") || "—"} />
                <Row k="Submission" v={rules.submissionInstructions} />
              </tbody>
            </table>
            <RuleEditor campaignId={campaign.id} initialRules={rules} />
          </div>

          {(() => {
            const p = scoreCampaign(rules);
            const decision = shouldProcess(rules, campaign.status);
            return (
              <div className="card">
                <h3>Profitability</h3>
                <table>
                  <tbody>
                    <Row k="Effective CPM" v={p.effectiveCpm} />
                    <Row k="Expected qualified views" v={p.expectedQualifiedViews} />
                    <Row k="Estimated revenue" v={`$${p.estimatedRevenue.toFixed(2)}`} />
                    <Row k="Estimated profit" v={`$${p.estimatedProfit.toFixed(2)}`} />
                    <Row k="Priority score" v={p.priorityScore} />
                    <tr>
                      <th style={{ width: 220 }}>Process?</th>
                      <td>
                        <span className={`badge ${decision.process ? "ok" : "bad"}`}>
                          {decision.process ? "eligible" : "stop"}
                        </span>{" "}
                        <span className="muted">{decision.reasons.join("; ")}</span>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            );
          })()}

          {rules.uncertainties.length > 0 && (
            <div className="card">
              <h3>Uncertainties</h3>
              <ul>
                {rules.uncertainties.map((u, i) => (
                  <li key={i} className="muted">{u}</li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      <div className="card">
        <h3>Resources</h3>
        {campaign.resources.length === 0 ? (
          <p className="muted">No resource links.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Kind</th>
                <th>URL</th>
                <th>Permitted</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {campaign.resources.map((r) => (
                <tr key={r.id}>
                  <td className="muted">{r.kind}</td>
                  <td>
                    <a href={r.url} target="_blank" rel="noreferrer">
                      {r.url.slice(0, 60)}
                    </a>
                  </td>
                  <td>
                    <span className={`badge ${r.permitted ? "ok" : "bad"}`}>
                      {r.permitted ? "yes" : "no"}
                    </span>
                  </td>
                  <td className="muted">{r.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string | number | null | undefined }) {
  return (
    <tr>
      <th style={{ width: 220 }}>{k}</th>
      <td>{v === null || v === undefined || v === "" ? "—" : String(v)}</td>
    </tr>
  );
}
