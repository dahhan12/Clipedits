import "./globals.css";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { headers } from "next/headers";
import { sessionFromCookieHeader } from "@/lib/security/session";
import { appEnv } from "@/lib/config/deployEnv";
import { SessionBar } from "@/components/SessionBar";

export const metadata: Metadata = {
  title: "CampaignClipper",
  description: "Discover, parse, clip, and submit Content Rewards campaigns.",
};

const NAV: Array<{ href: string; label: string }> = [
  { href: "/", label: "Overview" },
  { href: "/campaigns", label: "New campaigns" },
  { href: "/campaigns?view=rules", label: "Campaign rules" },
  { href: "/assets", label: "Source assets" },
  { href: "/candidates", label: "Clip candidates" },
  { href: "/compliance", label: "Compliance" },
  { href: "/queue", label: "Approval queue" },
  { href: "/publications", label: "Publications" },
  { href: "/submissions", label: "Submissions" },
  { href: "/earnings", label: "Earnings" },
  { href: "/jobs", label: "Errors & jobs" },
  { href: "/providers", label: "Provider readiness" },
];

export default async function RootLayout({ children }: { children: ReactNode }) {
  const session = sessionFromCookieHeader((await headers()).get("cookie"));
  return (
    <html lang="en">
      <body>
        <div className="layout">
          <aside className="sidebar" style={{ display: "flex", flexDirection: "column" }}>
            <h1>🎬 CampaignClipper</h1>
            <nav style={{ flex: 1 }}>
              {NAV.map((n) => (
                <a key={n.href} href={n.href}>
                  {n.label}
                </a>
              ))}
            </nav>
            <SessionBar role={session?.role ?? null} />
          </aside>
          <main className="main">
            {appEnv() !== "production" && (
              <div
                style={{
                  background: appEnv() === "staging" ? "#7c4d00" : "#334",
                  color: "#fff",
                  padding: "6px 12px",
                  borderRadius: 6,
                  marginBottom: 14,
                  fontSize: 12,
                  fontWeight: 600,
                  letterSpacing: "0.03em",
                }}
              >
                {appEnv().toUpperCase()} ENVIRONMENT — not production. Public posting is{" "}
                {appEnv() === "staging" || appEnv() === "production" ? "enabled for test accounts" : "disabled (draft only)"}.
              </div>
            )}
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
