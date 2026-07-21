import { headers } from "next/headers";
import { getQueueDepths, getJobRunStats, getPipelineFunnel } from "@/lib/observability/metrics";
import { listDeadLetters } from "@/services/ops/replayService";
import { getProviderMetrics } from "@/lib/observability/providerMetrics";
import { getKillSwitchState } from "@/services/ops/killSwitch";
import { getUsageSummary } from "@/services/ops/costService";
import { currentRole } from "@/lib/security/rbac";
import { ReplayButton } from "@/components/ReplayButton";
import { KillSwitchControls } from "@/components/KillSwitchControls";

export const dynamic = "force-dynamic";

export default async function ObservabilityPage() {
  const isAdmin = currentRole(await headers()) === "ADMIN";
  const [depths, jobStats, funnel, deadLetters, providers, killSwitches, usage] = await Promise.all([
    getQueueDepths(),
    getJobRunStats(),
    getPipelineFunnel(),
    listDeadLetters(50),
    getProviderMetrics(7),
    getKillSwitchState(),
    getUsageSummary(7),
  ]);

  const funnelRows: Array<[string, number]> = [
    ["Campaigns", funnel.campaigns],
    ["Needs review", funnel.needsReview],
    ["Source assets", funnel.assets],
    ["Clip candidates", funnel.candidates],
    ["Rendered clips", funnel.rendered],
    ["Publications", funnel.publications],
    ["Submissions", funnel.submissions],
    ["Failed jobs", funnel.failedJobs],
  ];

  return (
    <div>
      <h2>Observability</h2>
      <p className="muted">
        Live pipeline funnel, queue depths and job-run outcomes. Workers log with a
        correlation id per job for tracing across stages.
      </p>

      <div className="stat-grid" style={{ marginBottom: 16 }}>
        {funnelRows.map(([label, n]) => (
          <div className="stat" key={label}>
            <div className="n">{n}</div>
            <div className="l">{label}</div>
          </div>
        ))}
      </div>

      {isAdmin && <KillSwitchControls initial={killSwitches} />}

      <div className="card">
        <h3>Estimated spend (7d)</h3>
        <p className="muted">
          Coarse per-operation estimates (AI, render, publish) per workspace/day — for
          dashboards and soft caps, not billing.{" "}
          {killSwitches.globalDailyCapUsd != null && (
            <>Global daily cap: <strong>${killSwitches.globalDailyCapUsd.toFixed(2)}</strong>.</>
          )}
        </p>
        {usage.length === 0 ? (
          <p className="muted">No usage recorded yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Workspace</th>
                <th>Day</th>
                <th>AI calls</th>
                <th>Render s</th>
                <th>Publishes</th>
                <th>Est. cost</th>
              </tr>
            </thead>
            <tbody>
              {usage.map((u) => (
                <tr key={`${u.workspaceId}-${u.day.toISOString()}`}>
                  <td className="muted">{u.workspaceId === "__shared__" ? "shared pool" : u.workspaceId}</td>
                  <td className="muted">{new Date(u.day).toISOString().slice(0, 10)}</td>
                  <td>{u.aiCalls}</td>
                  <td>{u.renderSeconds.toFixed(0)}</td>
                  <td>{u.publishCount}</td>
                  <td>${u.costUsd.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h3>Queue depths</h3>
        <table>
          <thead>
            <tr>
              <th>Queue</th>
              <th>Waiting</th>
              <th>Active</th>
              <th>Delayed</th>
              <th>Failed</th>
              <th>Completed</th>
            </tr>
          </thead>
          <tbody>
            {depths.map((d) => (
              <tr key={d.name}>
                <td>{d.name}</td>
                <td>{d.waiting}</td>
                <td>{d.active}</td>
                <td>{d.delayed}</td>
                <td>{d.failed ? <span className="badge bad">{d.failed}</span> : 0}</td>
                <td className="muted">{d.completed}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h3>Job-run outcomes</h3>
        {jobStats.length === 0 ? (
          <p className="muted">No job runs recorded yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Queue</th>
                <th>Status</th>
                <th>Count</th>
              </tr>
            </thead>
            <tbody>
              {jobStats.map((s) => (
                <tr key={`${s.queue}-${s.status}`}>
                  <td>{s.queue}</td>
                  <td>
                    <span className={`badge ${s.status === "SUCCEEDED" ? "ok" : s.status === "FAILED" ? "bad" : "warn"}`}>
                      {s.status}
                    </span>
                  </td>
                  <td>{s.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h3>Dead letters</h3>
        <p className="muted">
          Jobs whose retries were exhausted, bucketed by failure category. Retryable
          categories (network / rate-limit / timeout) replay directly; others require a
          deliberate force override, which is audited.
        </p>
        {deadLetters.length === 0 ? (
          <p className="muted">No dead-lettered jobs. 🎉</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Queue</th>
                <th>Job key</th>
                <th>Category</th>
                <th>Error</th>
                <th>When</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {deadLetters.map((d) => (
                <tr key={d.id}>
                  <td>{d.queue}</td>
                  <td className="muted" style={{ maxWidth: 220, overflowWrap: "anywhere" }}>{d.jobKey}</td>
                  <td>
                    <span className={`badge ${d.retryable ? "warn" : "bad"}`}>
                      {d.failureCategory ?? "UNKNOWN"}
                    </span>
                  </td>
                  <td className="muted" style={{ maxWidth: 320, overflowWrap: "anywhere" }}>{d.error}</td>
                  <td className="muted">{d.deadLetteredAt ? new Date(d.deadLetteredAt).toLocaleString() : "—"}</td>
                  <td>
                    <ReplayButton queue={d.queue} jobKey={d.jobKey} retryable={d.retryable} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h3>Provider API metrics (7d)</h3>
        <p className="muted">
          Latency and error rate for external calls (Anthropic, Whisper, publishing
          platforms). Aggregated per provider + operation; empty until live calls run.
        </p>
        {providers.length === 0 ? (
          <p className="muted">No provider calls recorded yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Provider</th>
                <th>Operation</th>
                <th>Calls</th>
                <th>Errors</th>
                <th>Error rate</th>
                <th>Avg ms</th>
                <th>Max ms</th>
                <th>Last error</th>
              </tr>
            </thead>
            <tbody>
              {providers.map((p) => (
                <tr key={`${p.provider}-${p.operation}`}>
                  <td>{p.provider}</td>
                  <td className="muted">{p.operation}</td>
                  <td>{p.calls}</td>
                  <td>{p.errors ? <span className="badge bad">{p.errors}</span> : 0}</td>
                  <td>
                    <span className={`badge ${p.errorRate > 0.1 ? "bad" : p.errorRate > 0 ? "warn" : "ok"}`}>
                      {(p.errorRate * 100).toFixed(1)}%
                    </span>
                  </td>
                  <td>{p.avgMs}</td>
                  <td className="muted">{p.maxMs}</td>
                  <td className="muted" style={{ maxWidth: 280, overflowWrap: "anywhere" }}>{p.lastError ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
