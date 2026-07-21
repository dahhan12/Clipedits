import { getQueueDepths, getJobRunStats, getPipelineFunnel } from "@/lib/observability/metrics";

export const dynamic = "force-dynamic";

export default async function ObservabilityPage() {
  const [depths, jobStats, funnel] = await Promise.all([
    getQueueDepths(),
    getJobRunStats(),
    getPipelineFunnel(),
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
    </div>
  );
}
