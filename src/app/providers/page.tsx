import { providerReadiness, type ReadinessStatus } from "@/lib/providers/readiness";
import { getVerifications } from "@/lib/providers/verification";

export const dynamic = "force-dynamic";

function statusClass(s: ReadinessStatus): string {
  if (s === "LIVE_VERIFIED") return "ok";
  if (s === "SANDBOX_VERIFIED" || s === "LIVE_PARTIALLY_VERIFIED") return "warn";
  return "bad";
}

export default async function ProvidersPage() {
  const rows = providerReadiness(await getVerifications());
  const verifiedCount = rows.filter((r) => r.status === "LIVE_VERIFIED").length;
  return (
    <div>
      <h2>Provider readiness</h2>
      <p className="muted">
        Honest status of every external integration.{" "}
        {verifiedCount === 0 ? (
          <>
            No integration is <strong>LIVE_VERIFIED</strong> yet
          </>
        ) : (
          <>
            <strong>{verifiedCount}</strong> integration{verifiedCount === 1 ? "" : "s"} LIVE_VERIFIED
          </>
        )}{" "}
        — status only advances to LIVE_VERIFIED when <code>npm run verify:live</code> records a real
        passing check; publishing is gated by real capability, and sandbox modes never fabricate
        success. See docs/PRODUCTION_READINESS_AUDIT.md and docs/LIVE_VERIFICATION.md.
      </p>
      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Provider</th>
              <th>Category</th>
              <th>Status</th>
              <th>Credentials</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <td>{r.name}</td>
                <td className="muted">{r.category}</td>
                <td>
                  <span className={`badge ${statusClass(r.status)}`}>{r.status}</span>
                  {r.requiresApproval && <span className="badge bad" style={{ marginLeft: 6 }}>approval</span>}
                </td>
                <td>
                  <span className={`badge ${r.credentialsPresent ? "ok" : "warn"}`}>
                    {r.credentialsPresent ? "present" : "missing"}
                  </span>
                </td>
                <td className="muted">{r.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
