"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

function useAction(endpoint: string) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const run = () =>
    start(async () => {
      setMsg(null);
      try {
        const res = await fetch(endpoint, { method: "POST" });
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) setMsg(body.error ?? `Failed (${res.status})`);
        else router.refresh();
      } catch (e) {
        setMsg(e instanceof Error ? e.message : "Request failed");
      }
    });
  return { run, pending, msg };
}

export function DiscoverButton() {
  const { run, pending, msg } = useAction("/api/discovery/run");
  return (
    <span>
      <button className="btn" onClick={run} disabled={pending}>
        {pending ? "Discovering…" : "Run discovery"}
      </button>
      {msg && <span className="badge bad" style={{ marginLeft: 8 }}>{msg}</span>}
    </span>
  );
}

export function ReparseButton({ campaignId }: { campaignId: string }) {
  const { run, pending, msg } = useAction(`/api/campaigns/${campaignId}/reparse`);
  return (
    <span>
      <button className="btn secondary" onClick={run} disabled={pending}>
        {pending ? "Reparsing…" : "Reparse campaign"}
      </button>
      {msg && <span className="badge bad" style={{ marginLeft: 8 }}>{msg}</span>}
    </span>
  );
}

export function DownloadResourcesButton({ campaignId }: { campaignId: string }) {
  const { run, pending, msg } = useAction(`/api/campaigns/${campaignId}/download`);
  return (
    <span>
      <button className="btn secondary" onClick={run} disabled={pending}>
        {pending ? "Queuing…" : "Download resources"}
      </button>
      {msg && <span className="badge bad" style={{ marginLeft: 8 }}>{msg}</span>}
    </span>
  );
}

export function GenerateClipsButton({ assetId }: { assetId: string }) {
  const { run, pending, msg } = useAction(`/api/assets/${assetId}/generate-clips`);
  return (
    <span>
      <button className="btn secondary" onClick={run} disabled={pending}>
        {pending ? "Queuing…" : "Generate clips"}
      </button>
      {msg && <span className="badge bad" style={{ marginLeft: 8 }}>{msg}</span>}
    </span>
  );
}
