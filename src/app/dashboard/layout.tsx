import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "./actions";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name, username")
    .eq("id", user.id)
    .maybeSingle();

  const displayName = profile?.display_name ?? profile?.username ?? user.email ?? "Manager";

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "#0d0d1a", color: "#f4f4f8" }}>
      {/* ── Top nav ── */}
      <header
        className="sticky top-0 z-50 px-6 sm:px-12"
        style={{ background: "#0d0d1a", borderBottom: "1px solid #2a2a40" }}
      >
        <div className="mx-auto max-w-6xl flex items-center justify-between h-14">
          {/* Logo */}
          <Link
            href="/dashboard"
            className="flex items-center gap-2 select-none"
          >
            <span
              className="text-2xl tracking-wider"
              style={{ fontFamily: "var(--font-display, sans-serif)", color: "#FFD700", letterSpacing: "0.05em" }}
            >
              UFF
            </span>
            <span className="text-xs uppercase tracking-widest text-white hidden sm:inline">
              Ultimate Fantasy Football
            </span>
          </Link>

          {/* Right side */}
          <div className="flex items-center gap-5">
            <Link
              href="/dashboard"
              className="text-sm font-medium text-white hover:text-white transition-colors"
            >
              My Leagues
            </Link>

            <span className="text-sm text-white hidden sm:inline truncate max-w-[160px]">
              {displayName}
            </span>

            <form action={signOut}>
              <button
                type="submit"
                className="text-sm font-medium text-white hover:text-white transition-colors"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>

      {/* ── Page content ── */}
      <div className="flex-1">
        {children}
      </div>
    </div>
  );
}
