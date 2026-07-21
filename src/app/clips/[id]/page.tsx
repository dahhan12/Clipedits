import { notFound } from "next/navigation";
import { prisma } from "@/lib/db/prisma";
import { RenderManifestSchema } from "@/lib/schemas/render";

export const dynamic = "force-dynamic";

export default async function ClipPreviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const clip = await prisma.renderedClip
    .findUnique({
      where: { id },
      include: { compliance: true, candidate: { include: { sourceAsset: { include: { campaign: true } } } } },
    })
    .catch(() => null);

  if (!clip) notFound();

  const manifest = RenderManifestSchema.safeParse(clip.renderManifest);
  const campaign = clip.candidate.sourceAsset.campaign;

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
