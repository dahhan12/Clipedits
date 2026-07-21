"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

/** Add a campaign manually by pasting a campaign URL or raw campaign text. */
export function ManualCampaignForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"url" | "text">("url");
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [title, setTitle] = useState("");
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  const submit = () =>
    start(async () => {
      setMsg(null);
      const body =
        mode === "url" ? { mode, url } : { mode, text, title: title || undefined };
      try {
        const res = await fetch("/api/campaigns/manual", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = (await res.json().catch(() => ({}))) as { error?: string; campaignId?: string };
        if (!res.ok) {
          setMsg(data.error ?? `Failed (${res.status})`);
        } else if (data.campaignId) {
          router.push(`/campaigns/${data.campaignId}`);
        }
      } catch (e) {
        setMsg(e instanceof Error ? e.message : "Request failed");
      }
    });

  if (!open) {
    return (
      <button className="btn" onClick={() => setOpen(true)}>
        + Add campaign
      </button>
    );
  }

  return (
    <div className="card" style={{ marginTop: 12 }}>
      <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
        <button className={`btn ${mode === "url" ? "" : "secondary"}`} onClick={() => setMode("url")}>
          By URL
        </button>
        <button className={`btn ${mode === "text" ? "" : "secondary"}`} onClick={() => setMode("text")}>
          By pasted text
        </button>
        <button className="btn secondary" onClick={() => setOpen(false)} style={{ marginLeft: "auto" }}>
          Close
        </button>
      </div>

      {mode === "url" ? (
        <input
          type="url"
          placeholder="https://contentrewards.com/discover/…"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          style={{ width: "100%", padding: 8 }}
        />
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          <input
            type="text"
            placeholder="Optional title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            style={{ width: "100%", padding: 8 }}
          />
          <textarea
            placeholder="Paste the full campaign text / requirements here…"
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={8}
            style={{ width: "100%", padding: 8, fontFamily: "inherit" }}
          />
        </div>
      )}

      <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10 }}>
        <button className="btn" onClick={submit} disabled={pending}>
          {pending ? "Parsing…" : "Add & parse"}
        </button>
        {msg && <span className="badge bad">{msg}</span>}
      </div>
    </div>
  );
}
