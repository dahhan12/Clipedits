"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

const PLATFORMS = [
  { value: "TIKTOK", label: "TikTok" },
  { value: "INSTAGRAM_REELS", label: "IG Reels" },
  { value: "YOUTUBE_SHORTS", label: "YT Shorts" },
] as const;

/** Publish controls for a rendered clip: pick a platform, then draft or publish now. */
export function PublishControls({ clipId }: { clipId: string }) {
  const router = useRouter();
  const [platform, setPlatform] = useState<string>("TIKTOK");
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  const publish = (mode: "DRAFT" | "AUTO") =>
    start(async () => {
      setMsg(null);
      try {
        const res = await fetch(`/api/clips/${clipId}/publish`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ platform, mode }),
        });
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) setMsg(body.error ?? `Failed (${res.status})`);
        else {
          setMsg(mode === "AUTO" ? "Publish queued" : "Draft queued");
          router.refresh();
        }
      } catch (e) {
        setMsg(e instanceof Error ? e.message : "Request failed");
      }
    });

  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <select value={platform} onChange={(e) => setPlatform(e.target.value)} disabled={pending}>
        {PLATFORMS.map((p) => (
          <option key={p.value} value={p.value}>
            {p.label}
          </option>
        ))}
      </select>
      <button className="btn secondary" onClick={() => publish("DRAFT")} disabled={pending}>
        Publish as draft
      </button>
      <button className="btn" onClick={() => publish("AUTO")} disabled={pending}>
        Publish now
      </button>
      {msg && <span className="badge">{msg}</span>}
    </div>
  );
}
