"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const BASE_NAV = [
  { label: "League",        href: "" },
  { label: "Managers",      href: "/managers" },
  { label: "Roster",        href: "/roster" },
  { label: "Matchups",      href: "/matchups" },
  { label: "Standings",     href: "/standings" },
  { label: "Free Agents",   href: "/free-agents" },
  { label: "Trade",         href: "/trade" },
  { label: "Transactions",  href: "/transactions" },
  { label: "Record Book",   href: "/record-book" },
  { label: "Trade Block",   href: "/trade-block" },
  { label: "Playoffs",      href: "/playoffs" },
];

const COMMISSIONER_NAV = [
  ...BASE_NAV,
  { label: "Settings", href: "/settings" },
];

export default function LeagueNav({
  leagueId,
  isCommissioner,
  pendingTradeCount = 0,
}: {
  leagueId: string;
  isCommissioner: boolean;
  pendingTradeCount?: number;
}) {
  const pathname = usePathname();
  const base = `/dashboard/league/${leagueId}`;
  const navItems = isCommissioner ? COMMISSIONER_NAV : BASE_NAV;

  return (
    <nav
      className="sticky top-0 z-40 border-b px-4"
      style={{ background: "rgba(13,13,26,0.95)", borderColor: "#2a2a40", backdropFilter: "blur(8px)" }}
    >
      <div className="mx-auto flex max-w-6xl items-center gap-1 overflow-x-auto">
        {/* UFF wordmark */}
        <Link
          href="/dashboard"
          className="mr-3 shrink-0 text-sm font-bold uppercase tracking-widest"
          style={{ color: "#FFD700" }}
        >
          UFF
        </Link>

        {navItems.map(({ label, href }) => {
          const fullHref = base + href;
          const isActive =
            href === ""
              ? pathname === base || pathname === base + "/"
              : pathname.startsWith(fullHref);
          const hasBadge = label === "Trade" && pendingTradeCount > 0;
          return (
            <Link
              key={label}
              href={fullHref}
              className="relative shrink-0 px-3 py-3 text-sm font-medium transition-colors"
              style={{
                color: isActive ? "#FFD700" : "#f4f4f8",
                borderBottom: isActive ? "2px solid #FFD700" : "2px solid transparent",
              }}
            >
              {label}
              {hasBadge && (
                <span
                  className="absolute top-1.5 right-0 inline-flex items-center justify-center rounded-full font-bold"
                  style={{
                    background: "#CC0000",
                    color: "#fff",
                    fontSize: "9px",
                    minWidth: "14px",
                    height: "14px",
                    padding: "0 3px",
                  }}
                >
                  {pendingTradeCount}
                </span>
              )}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
