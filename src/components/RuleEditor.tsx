"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

/**
 * Edit the campaign's rules as validated JSON. Saving creates a new reviewed
 * revision (it never overwrites the model's original extraction). The server
 * re-validates against the Zod schema and reports validation errors inline.
 */
export function RuleEditor({ campaignId, initialRules }: { campaignId: string; initialRules: unknown }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(() => JSON.stringify(initialRules, null, 2));
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ kind: "ok" | "bad"; text: string } | null>(null);

  const save = () =>
    start(async () => {
      setMsg(null);
      let parsed: unknown;
      try {
        parsed = JSON.parse(value);
      } catch {
        setMsg({ kind: "bad", text: "Invalid JSON" });
        return;
      }
      try {
        const res = await fetch(`/api/campaigns/${campaignId}/rules`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(parsed),
        });
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) setMsg({ kind: "bad", text: data.error ?? `Failed (${res.status})` });
        else {
          setMsg({ kind: "ok", text: "Saved as new reviewed revision" });
          router.refresh();
        }
      } catch (e) {
        setMsg({ kind: "bad", text: e instanceof Error ? e.message : "Request failed" });
      }
    });

  if (!open) {
    return (
      <button className="btn secondary" onClick={() => setOpen(true)}>
        Edit rules
      </button>
    );
  }

  return (
    <div style={{ marginTop: 12 }}>
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        rows={20}
        spellCheck={false}
        style={{ width: "100%", fontFamily: "ui-monospace, monospace", fontSize: 12, padding: 10 }}
      />
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}>
        <button className="btn" onClick={save} disabled={pending}>
          {pending ? "Saving…" : "Save reviewed revision"}
        </button>
        <button className="btn secondary" onClick={() => setOpen(false)} disabled={pending}>
          Cancel
        </button>
        {msg && <span className={`badge ${msg.kind === "ok" ? "ok" : "bad"}`}>{msg.text}</span>}
      </div>
    </div>
  );
}
