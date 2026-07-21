"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type Area = "publishing" | "rendering" | "ai";

/**
 * Admin kill-switch + global daily cap controls. Each toggle immediately halts
 * or releases spendy work; the cap bounds estimated daily spend. Rendered only
 * for ADMINs (the page gates visibility); the route re-checks the role.
 */
export function KillSwitchControls({
  initial,
}: {
  initial: { publishing: boolean; rendering: boolean; ai: boolean; globalDailyCapUsd: number | null };
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [state, setState] = useState(initial);
  const [capInput, setCapInput] = useState(initial.globalDailyCapUsd?.toString() ?? "");
  const [msg, setMsg] = useState<string | null>(null);

  const post = (body: unknown) =>
    start(async () => {
      setMsg(null);
      try {
        const res = await fetch("/api/ops/killswitch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = (await res.json().catch(() => ({}))) as { error?: string; state?: typeof state };
        if (!res.ok) setMsg(data.error ?? `Failed (${res.status})`);
        else {
          if (data.state) setState(data.state);
          router.refresh();
        }
      } catch (e) {
        setMsg(e instanceof Error ? e.message : "Request failed");
      }
    });

  const areas: Area[] = ["publishing", "rendering", "ai"];

  return (
    <div className="card" style={{ borderColor: "#c0392b" }}>
      <h3>Kill switches &amp; spend cap</h3>
      <p className="muted">Halt spendy work instantly, or bound estimated daily spend. Admin only.</p>

      <table>
        <tbody>
          {areas.map((a) => {
            const halted = state[a];
            return (
              <tr key={a}>
                <td style={{ textTransform: "capitalize" }}>{a}</td>
                <td>
                  <span className={`badge ${halted ? "bad" : "ok"}`}>{halted ? "HALTED" : "running"}</span>
                </td>
                <td>
                  <button
                    className={`btn ${halted ? "secondary" : ""}`}
                    disabled={pending}
                    onClick={() => post({ area: a, halted: !halted })}
                  >
                    {halted ? "Release" : "Halt"}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div style={{ marginTop: 12, display: "flex", gap: 8, alignItems: "center" }}>
        <label className="muted">Global daily cap (USD)</label>
        <input
          type="number"
          min={0}
          step="0.01"
          value={capInput}
          onChange={(e) => setCapInput(e.target.value)}
          style={{ width: 120 }}
          placeholder="none"
        />
        <button
          className="btn secondary"
          disabled={pending}
          onClick={() => post({ globalDailyCapUsd: capInput.trim() === "" ? null : Number(capInput) })}
        >
          Save cap
        </button>
        <span className="muted">
          current: {state.globalDailyCapUsd == null ? "none" : `$${state.globalDailyCapUsd.toFixed(2)}`}
        </span>
      </div>

      {msg && (
        <span className="badge warn" style={{ marginTop: 8, display: "inline-block" }}>
          {msg}
        </span>
      )}
    </div>
  );
}
