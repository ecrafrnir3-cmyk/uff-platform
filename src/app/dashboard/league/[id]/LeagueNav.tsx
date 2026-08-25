"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const BASE_NAV = [
  { label: "League",        href: "" },
  { label: "Character",     href: "/character" },
  { label: "Managers",      href: "/managers" },
  { label: "Roster",        href: "/roster" },
  { label: "Matchups",      href: "/matchups" },
  { label: "Standings",     href: "/standings" },
  { label: "Free Agents",   href: "/free-agents" },
  { label: "Players",       href: "/players" },
  { label: "Trade",         href: "/trade" },
  { label: "Trade Log",     href: "/trades" },
  { label: "Transactions",  href: "/transactions" },
  { label: "Record Book",   href: "/record-book" },
  { label: "Trade Block",   href: "/trade-block" },
  { label: "Playoffs",      href: "/playoffs" },
  { label: "Schedule",        href: "/schedule" },
  { label: "Bulletin Board",  href: "/announcements" },
  { label: "Chat",             href: "/chat" },
];

const COMMISSIONER_NAV = [
  ...BASE_NAV,
  { label: "Settings", href: "/settings" },
];

export default function LeagueNav({
  leagueId,
  isCommissioner,
  pendingTradeCount = 0,
  unreadNotifCount = 0,
}: {
  leagueId: string;
  isCommissioner: boolean;
  pendingTradeCount?: number;
  unreadNotifCount?: number;
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
          const hasTradeBadge = label === "Trade" && pendingTradeCount > 0;
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
              {hasTradeBadge && (
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

        {/* Notification bell — far right */}
        <Link
          href={`${base}/notifications`}
          className="relative ml-auto shrink-0 px-2 py-3 text-base transition-opacity hover:opacity-70"
          style={{ color: pathname.startsWith(`${base}/notifications`) ? "#FFD700" : "#d4d4e8" }}
          title="Notifications"
        >
          🔔
          {unreadNotifCount > 0 && (
            <span
              className="absolute top-1.5 right-0 inline-flex items-center justify-center rounded-full font-bold"
              style={{
                background: "#0057FF",
                color: "#fff",
                fontSize: "9px",
                minWidth: "14px",
                height: "14px",
                padding: "0 3px",
              }}
            >
              {unreadNotifCount > 9 ? "9+" : unreadNotifCount}
            </span>
          )}
        </Link>
      </div>
    </nav>
  );
}
