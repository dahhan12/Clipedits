"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    start(async () => {
      setMsg(null);
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (res.ok) router.push("/");
      else {
        const b = (await res.json().catch(() => ({}))) as { error?: string };
        setMsg(b.error ?? "Login failed");
      }
    });
  };

  return (
    <div style={{ maxWidth: 360, margin: "10vh auto" }}>
      <h2>Sign in</h2>
      <form onSubmit={submit} className="card" style={{ display: "grid", gap: 10 }}>
        <input type="email" placeholder="email" value={email} onChange={(e) => setEmail(e.target.value)} style={{ padding: 8 }} required />
        <input type="password" placeholder="password" value={password} onChange={(e) => setPassword(e.target.value)} style={{ padding: 8 }} required />
        <button className="btn" type="submit" disabled={pending}>
          {pending ? "Signing in…" : "Sign in"}
        </button>
        {msg && <span className="badge bad">{msg}</span>}
      </form>
    </div>
  );
}
