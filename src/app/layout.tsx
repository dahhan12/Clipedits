import "./globals.css";
import type { Metadata } from "next";
import type { ReactNode } from "react";

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
];

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="layout">
          <aside className="sidebar">
            <h1>🎬 CampaignClipper</h1>
            <nav>
              {NAV.map((n) => (
                <a key={n.href} href={n.href}>
                  {n.label}
                </a>
              ))}
            </nav>
          </aside>
          <main className="main">{children}</main>
        </div>
      </body>
    </html>
  );
}
