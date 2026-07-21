import { prisma } from "@/lib/db/prisma";

export const dynamic = "force-dynamic";

export default async function JobsPage() {
  const jobs = await prisma.jobRun
    .findMany({ orderBy: { createdAt: "desc" }, take: 100 })
    .catch(() => []);

  return (
    <div>
      <h2>Errors &amp; jobs</h2>
      <div className="card">
        {jobs.length === 0 ? (
          <p className="muted">No job runs recorded yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Queue</th>
                <th>Job key</th>
                <th>Status</th>
                <th>Attempts</th>
                <th>Error</th>
                <th>When</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((j) => (
                <tr key={j.id}>
                  <td className="muted">{j.queue}</td>
                  <td>{j.jobKey}</td>
                  <td>
                    <span
                      className={`badge ${
                        j.status === "SUCCEEDED" ? "ok" : j.status === "FAILED" ? "bad" : "warn"
                      }`}
                    >
                      {j.status}
                    </span>
                  </td>
                  <td>{j.attempts}</td>
                  <td className="muted">{j.error?.slice(0, 80) ?? "—"}</td>
                  <td className="muted">{j.createdAt.toISOString().slice(0, 16).replace("T", " ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
