"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const BASE_NAV = [
  { label: "League",        href: "" },
  { label: "Roster",        href: "/roster" },
  { label: "Matchups",      href: "/matchups" },
  { label: "Standings",     href: "/standings" },
  { label: "Free Agents",   href: "/free-agents" },
  { label: "Trade",         href: "/trade" },
  { label: "Transactions",  href: "/transactions" },
  { label: "Record Book",   href: "/record-book" },
];

const COMMISSIONER_NAV = [
  ...BASE_NAV,
  { label: "Settings", href: "/settings" },
];

export default function LeagueNav({
  leagueId,
  isCommissioner,
}: {
  leagueId: string;
  isCommissioner: boolean;
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
          return (
            <Link
              key={label}
              href={fullHref}
              className="shrink-0 px-3 py-3 text-sm font-medium transition-colors"
              style={{
                color: isActive ? "#FFD700" : "#f4f4f8",
                borderBottom: isActive ? "2px solid #FFD700" : "2px solid transparent",
              }}
            >
              {label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
