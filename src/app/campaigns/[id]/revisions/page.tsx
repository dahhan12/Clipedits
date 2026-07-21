import { notFound } from "next/navigation";
import { prisma } from "@/lib/db/prisma";

export const dynamic = "force-dynamic";

/** Flatten a nested object into dot-path → string for a simple field diff. */
function flatten(obj: unknown, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  if (obj === null || typeof obj !== "object") {
    out[prefix || "(value)"] = JSON.stringify(obj);
    return out;
  }
  if (Array.isArray(obj)) {
    out[prefix] = JSON.stringify(obj);
    return out;
  }
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === "object" && !Array.isArray(v)) Object.assign(out, flatten(v, path));
    else out[path] = JSON.stringify(v);
  }
  return out;
}

function diff(a: unknown, b: unknown): Array<{ field: string; from: string; to: string }> {
  const fa = flatten(a);
  const fb = flatten(b);
  const keys = new Set([...Object.keys(fa), ...Object.keys(fb)]);
  const rows: Array<{ field: string; from: string; to: string }> = [];
  for (const k of [...keys].sort()) {
    const from = fa[k] ?? "—";
    const to = fb[k] ?? "—";
    if (from !== to) rows.push({ field: k, from, to });
  }
  return rows;
}

export default async function RevisionsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const campaign = await prisma.campaign
    .findUnique({
      where: { id },
      include: { rules: { orderBy: { createdAt: "desc" } } },
    })
    .catch(() => null);
  if (!campaign) notFound();

  const revisions = campaign.rules;
  const [newer, older] = revisions;
  const changes = newer && older ? diff(older.rules, newer.rules) : [];

  return (
    <div>
      <h2>
        Rule revisions <span className="muted">· {campaign.title ?? campaign.externalId}</span>
      </h2>
      <p className="muted">
        <a href={`/campaigns/${campaign.id}`}>← back to campaign</a>
      </p>

      <div className="card">
        <h3>History ({revisions.length})</h3>
        {revisions.length === 0 ? (
          <p className="muted">No rule revisions yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>When</th>
                <th>Source</th>
                <th>Status</th>
                <th>Confidence</th>
              </tr>
            </thead>
            <tbody>
              {revisions.map((r, i) => (
                <tr key={r.id}>
                  <td>{revisions.length - i}</td>
                  <td className="muted">{r.createdAt.toISOString().slice(0, 16).replace("T", " ")}</td>
                  <td>{r.model === "manual-review" ? <span className="badge">manual review</span> : (r.model ?? "—")}</td>
                  <td>
                    <span className={`badge ${r.status === "PARSED" ? "ok" : "warn"}`}>{r.status}</span>
                  </td>
                  <td>{r.confidence.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {newer && older && (
        <div className="card">
          <h3>Changes: revision {revisions.length - 1} → {revisions.length} (latest)</h3>
          {changes.length === 0 ? (
            <p className="muted">No field-level differences between the two most recent revisions.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Field</th>
                  <th>Before</th>
                  <th>After</th>
                </tr>
              </thead>
              <tbody>
                {changes.map((c) => (
                  <tr key={c.field}>
                    <td>{c.field}</td>
                    <td className="muted" style={{ color: "var(--bad)" }}>{c.from}</td>
                    <td style={{ color: "var(--ok)" }}>{c.to}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
