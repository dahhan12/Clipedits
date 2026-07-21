"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

/**
 * Replay a dead-lettered job. For a non-retryable failure category the first
 * click is refused (422) and the button switches to an explicit "Force replay"
 * so the operator makes a deliberate override — which is audited server-side.
 */
export function ReplayButton({
  queue,
  jobKey,
  retryable,
}: {
  queue: string;
  jobKey: string;
  retryable: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [forceMode, setForceMode] = useState(!retryable);

  const run = () =>
    start(async () => {
      setMsg(null);
      const qs = new URLSearchParams({ queue, jobKey, ...(forceMode ? { force: "1" } : {}) });
      try {
        const res = await fetch(`/api/jobs/replay?${qs.toString()}`, { method: "POST" });
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        if (res.status === 422) {
          setForceMode(true);
          setMsg("Not auto-retryable — click again to force.");
        } else if (!res.ok) {
          setMsg(body.error ?? `Failed (${res.status})`);
        } else {
          router.refresh();
        }
      } catch (e) {
        setMsg(e instanceof Error ? e.message : "Request failed");
      }
    });

  return (
    <span>
      <button
        className={`btn ${forceMode ? "" : "secondary"}`}
        onClick={run}
        disabled={pending}
        title={forceMode ? "Force replay a non-retryable failure" : "Replay this job"}
      >
        {pending ? "Replaying…" : forceMode ? "Force replay" : "Replay"}
      </button>
      {msg && (
        <span className="badge warn" style={{ marginLeft: 8 }}>
          {msg}
        </span>
      )}
    </span>
  );
}
