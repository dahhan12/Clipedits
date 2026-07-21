import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { prisma } from "@/lib/db/prisma";
import { actorFromHeaders, assertClipAccess, WorkspaceForbiddenError } from "@/lib/db/workspaceScope";
import { RenderManifestSchema } from "@/lib/schemas/render";
import { PublishControls } from "@/components/PublishControls";
import { PrePublicationReviewPanel } from "@/components/PrePublicationReviewPanel";
import { computeCapabilities } from "@/services/publishing/capabilityService";
import { evaluateReviewability } from "@/services/publishing/prePublicationService";
import { currentRole, can } from "@/lib/security/rbac";
import type { Platform } from "@/generated/prisma";

export const dynamic = "force-dynamic";

export default async function ClipPreviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    await assertClipAccess(id, actorFromHeaders(await headers()));
  } catch (err) {
    if (err instanceof WorkspaceForbiddenError) notFound();
    throw err;
  }
  const clip = await prisma.renderedClip
    .findUnique({
      where: { id },
      include: {
        compliance: true,
        publications: { orderBy: { createdAt: "desc" } },
        candidate: { include: { sourceAsset: { include: { campaign: true } } } },
      },
    })
    .catch(() => null);

  if (!clip) notFound();

  const hasFail = clip.compliance.some((r) => r.outcome === "FAIL");
  const overall: "PASS" | "REVIEW" | "FAIL" = hasFail
    ? "FAIL"
    : clip.compliance.some((r) => r.outcome === "REVIEW")
      ? "REVIEW"
      : "PASS";
  const manifestForCaps = RenderManifestSchema.safeParse(clip.renderManifest);
  const requiresInApp = manifestForCaps.success && manifestForCaps.data.requiresInAppAudioOrEffects;

  const platforms: Platform[] = ["TIKTOK", "INSTAGRAM_REELS", "YOUTUBE_SHORTS"];
  const connected = await prisma.socialAccount
    .findMany({ where: { active: true, platform: { in: platforms } }, select: { platform: true } })
    .catch(() => [] as { platform: Platform }[]);
  const connectedSet = new Set(connected.map((c) => c.platform));

  const capabilities = Object.fromEntries(
    platforms.map((p) => {
      const cap = computeCapabilities({
        platform: p,
        accountConnected: connectedSet.has(p),
        requiresInAppAudioOrEffects: requiresInApp,
        complianceOutcome: overall,
      });
      return [p, { canPublishNow: cap.maxMode === "AUTO", reasons: cap.reasons }];
    }),
  );

  const manifest = RenderManifestSchema.safeParse(clip.renderManifest);
  const campaign = clip.candidate.sourceAsset.campaign;

  // Operator override eligibility: only when there are REVIEW findings, no FAIL,
  // and the caller may auto-publish (publish.now → ADMIN).
  const reviewability = evaluateReviewability(clip.compliance.map((c) => ({ check: c.check, outcome: c.outcome })));
  const canReview = can(currentRole(await headers()), "publish.now");
  const showReviewPanel = overall === "REVIEW" && !hasFail && canReview;

  return (
    <div>
      <h2>
        Clip preview <span className="muted">· {campaign.title ?? campaign.externalId}</span>
      </h2>

      <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: 16 }}>
        <div className="card">
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <video
            src={`/api/clips/${clip.id}/video`}
            poster={clip.thumbnailKey ? `/api/clips/${clip.id}/thumbnail` : undefined}
            controls
            style={{ width: "100%", borderRadius: 8, background: "#000", aspectRatio: "9 / 16" }}
          />
          <p className="muted" style={{ marginTop: 8 }}>
            {clip.width}x{clip.height} · {clip.videoCodec}/{clip.audioCodec} ·{" "}
            {clip.durationSec ? `${clip.durationSec.toFixed(1)}s` : "—"}
          </p>
        </div>

        <div>
          {manifest.success && (
            <>
              <div className="card">
                <h3>Transformations ({manifest.data.backend})</h3>
                <ul>
                  {manifest.data.transformations.map((t, i) => (
                    <li key={i}>
                      <strong>{t.step}</strong> <span className="muted">{t.detail}</span>
                    </li>
                  ))}
                </ul>
                {manifest.data.overlaysApplied.length > 0 && (
                  <p className="muted">
                    Overlays: {manifest.data.overlaysApplied.map((o) => `${o.kind}:${o.value}`).join(", ")}
                  </p>
                )}
                {manifest.data.requiresInAppAudioOrEffects && (
                  <span className="badge warn">Requires in-app audio/effects → DRAFT/MANUAL</span>
                )}
              </div>

              <div className="card">
                <h3>Platform captions</h3>
                {Object.entries(manifest.data.captions).map(([platform, text]) => (
                  <div key={platform} style={{ marginBottom: 10 }}>
                    <div className="muted">{platform}</div>
                    <pre style={{ whiteSpace: "pre-wrap", margin: 0 }}>{text}</pre>
                  </div>
                ))}
              </div>
            </>
          )}

          {showReviewPanel && (
            <PrePublicationReviewPanel
              clipId={clip.id}
              waivableChecks={reviewability.waivableChecks}
              blockingChecks={reviewability.blockingChecks}
              platforms={platforms}
            />
          )}

          <div className="card">
            <h3>Publish</h3>
            {hasFail ? (
              <p className="badge bad">Blocked: a compliance check failed. Fix and re-render before publishing.</p>
            ) : (
              <PublishControls clipId={clip.id} capabilities={capabilities} />
            )}
            {clip.publications.length > 0 && (
              <table style={{ marginTop: 12 }}>
                <thead>
                  <tr>
                    <th>Platform</th>
                    <th>Mode</th>
                    <th>Status</th>
                    <th>Post</th>
                  </tr>
                </thead>
                <tbody>
                  {clip.publications.map((p) => (
                    <tr key={p.id}>
                      <td>{p.platform}</td>
                      <td>{p.mode}</td>
                      <td>
                        <span className={`badge ${p.status === "PUBLISHED" ? "ok" : p.status === "FAILED" || p.status === "SKIPPED" ? "bad" : "warn"}`}>
                          {p.status}
                        </span>
                      </td>
                      <td className="muted">
                        {p.postUrl ? (
                          <a href={p.postUrl} target="_blank" rel="noreferrer">
                            link
                          </a>
                        ) : (
                          p.failureReason?.slice(0, 40) ?? "—"
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="card">
            <h3>Compliance</h3>
            <table>
              <tbody>
                {clip.compliance.map((r) => (
                  <tr key={r.id}>
                    <td>{r.check}</td>
                    <td>
                      <span className={`badge ${r.outcome === "PASS" ? "ok" : r.outcome === "FAIL" ? "bad" : "warn"}`}>
                        {r.outcome}
                      </span>
                    </td>
                    <td className="muted">{r.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
