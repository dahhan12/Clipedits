"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";

/** Shows the current role and a sign-out button (or a sign-in link). */
export function SessionBar({ role }: { role: string | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  if (!role) {
    return (
      <a className="btn secondary" href="/login" style={{ display: "block", textAlign: "center" }}>
        Sign in
      </a>
    );
  }

  const logout = () =>
    start(async () => {
      await fetch("/api/auth/logout", { method: "POST" });
      router.push("/login");
      router.refresh();
    });

  return (
    <div style={{ fontSize: 12 }}>
      <div className="muted" style={{ marginBottom: 6 }}>
        Role: <span className="badge">{role}</span>
      </div>
      <button className="btn secondary" onClick={logout} disabled={pending} style={{ width: "100%" }}>
        {pending ? "…" : "Sign out"}
      </button>
    </div>
  );
}
