"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type Platform = "TIKTOK" | "INSTAGRAM_REELS" | "YOUTUBE_SHORTS";

/**
 * Operator override panel. Shown when a clip has REVIEW findings and no FAIL.
 * The operator must acknowledge every *waivable* REVIEW check and enter a
 * justification before approving; safety-critical (blocking) REVIEWs disable
 * approval entirely. Approve enqueues an AUTO publish under an audited override;
 * Reject records the decision without publishing.
 */
export function PrePublicationReviewPanel({
  clipId,
  waivableChecks,
  blockingChecks,
  platforms,
}: {
  clipId: string;
  waivableChecks: string[];
  blockingChecks: string[];
  platforms: Platform[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [platform, setPlatform] = useState<Platform>(platforms[0] ?? "TIKTOK");
  const [justification, setJustification] = useState("");
  const [acked, setAcked] = useState<Set<string>>(new Set());

  const allAcked = waivableChecks.every((c) => acked.has(c));
  const canApprove = blockingChecks.length === 0 && allAcked && justification.trim().length >= 3;

  const toggle = (c: string) =>
    setAcked((prev) => {
      const next = new Set(prev);
      next.has(c) ? next.delete(c) : next.add(c);
      return next;
    });

  const submit = (decision: "APPROVED" | "REJECTED") =>
    start(async () => {
      setMsg(null);
      try {
        const res = await fetch(`/api/clips/${clipId}/review`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            platform,
            mode: "AUTO",
            decision,
            justification,
            acknowledgedChecks: [...acked],
          }),
        });
        const body = (await res.json().catch(() => ({}))) as { error?: string; enqueued?: boolean };
        if (!res.ok) setMsg(body.error ?? `Failed (${res.status})`);
        else {
          setMsg(decision === "APPROVED" ? (body.enqueued ? "Approved — publish enqueued." : "Approved.") : "Rejected — recorded.");
          router.refresh();
        }
      } catch (e) {
        setMsg(e instanceof Error ? e.message : "Request failed");
      }
    });

  return (
    <div className="card" style={{ borderColor: "#c98a00" }}>
      <h3>Operator review · override</h3>
      <p className="muted">
        This clip has REVIEW findings. Approving records an audited override and permits
        auto-posting; a FAIL can never be overridden here.
      </p>

      {blockingChecks.length > 0 && (
        <p className="badge bad" style={{ display: "block", marginBottom: 10 }}>
          Not overridable — resolve at source: {blockingChecks.join(", ")}
        </p>
      )}

      <label className="muted" style={{ display: "block", marginBottom: 6 }}>
        Platform{" "}
        <select value={platform} onChange={(e) => setPlatform(e.target.value as Platform)}>
          {platforms.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </label>

      {waivableChecks.length > 0 && (
        <div style={{ margin: "8px 0" }}>
          <div className="muted">Acknowledge each REVIEW finding:</div>
          {waivableChecks.map((c) => (
            <label key={c} style={{ display: "block" }}>
              <input type="checkbox" checked={acked.has(c)} onChange={() => toggle(c)} /> {c}
            </label>
          ))}
        </div>
      )}

      <textarea
        placeholder="Justification (required) — what did you verify?"
        value={justification}
        onChange={(e) => setJustification(e.target.value)}
        rows={3}
        style={{ width: "100%", marginBottom: 8 }}
      />

      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn" onClick={() => submit("APPROVED")} disabled={pending || !canApprove}>
          {pending ? "Working…" : "Approve override & publish"}
        </button>
        <button
          className="btn secondary"
          onClick={() => submit("REJECTED")}
          disabled={pending || justification.trim().length < 3}
        >
          Reject
        </button>
      </div>
      {msg && (
        <span className="badge warn" style={{ marginTop: 8, display: "inline-block" }}>
          {msg}
        </span>
      )}
    </div>
  );
}
