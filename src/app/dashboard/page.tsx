import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createLeague, joinLeague } from "./actions";
import { LEAGUE_SIZE_OPTIONS } from "./constants";

interface LeagueRow {
  team_name: string;
  is_commissioner: boolean;
  faction: "hero" | "villain" | null;
  uff_leagues: {
    id: string;
    name: string;
    season: string;
    join_code: string;
    status: string;
    max_teams: number;
  } | null;
}

const HERO_COLOR = "#0057FF";
const VILLAIN_COLOR = "#CC0000";

function FactionTag({ faction }: { faction: "hero" | "villain" | null }) {
  if (faction === "hero") {
    return <span style={{ color: HERO_COLOR }}>Hero</span>;
  }
  if (faction === "villain") {
    return <span style={{ color: VILLAIN_COLOR }}>Villain</span>;
  }
  return <span className="text-zinc-500">No faction yet</span>;
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
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

  const { data: memberships } = await supabase
    .from("league_members")
    .select("team_name, is_commissioner, faction, uff_leagues(id, name, season, join_code, status, max_teams)")
    .eq("user_id", user.id)
    .returns<LeagueRow[]>();

  const leagues = memberships ?? [];

  return (
    <div
      className="min-h-screen px-6 py-12 sm:px-12"
      style={{ background: "#0d0d1a", color: "#f4f4f8" }}
    >
      <main className="mx-auto flex max-w-3xl flex-col gap-8">
        <header>
          <h1
            className="text-3xl sm:text-4xl"
            style={{ fontFamily: "var(--font-display, sans-serif)", color: "#0057FF" }}
          >
            Welcome, {profile?.display_name ?? profile?.username ?? user.email}
          </h1>
        </header>

        {error && (
          <p className="rounded-md border px-3 py-2 text-sm" style={{ borderColor: "#CC0000", color: "#ff8a8a", background: "#1a0e16" }}>
            {decodeURIComponent(error)}
          </p>
        )}

        <section className="flex flex-col gap-4">
          <h2 className="text-xl font-semibold" style={{ color: "#FFD700" }}>
            My Leagues
          </h2>

          {leagues.length === 0 ? (
            <p className="text-sm text-zinc-400">
              You&rsquo;re not in any leagues yet — create one or join with a code below.
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              {leagues.map((m) => (
                <Link
                  key={m.uff_leagues?.id}
                  href={`/dashboard/league/${m.uff_leagues?.id}`}
                  className="flex items-center justify-between rounded-lg border px-4 py-3 transition hover:border-zinc-500"
                  style={{ borderColor: "#2a2a40" }}
                >
                  <div>
                    <p className="font-semibold">
                      {m.uff_leagues?.name}{" "}
                      {m.is_commissioner && (
                        <span className="ml-1 text-xs uppercase tracking-wide" style={{ color: "#FFD700" }}>
                          Commissioner
                        </span>
                      )}
                    </p>
                    <p className="text-sm text-zinc-400">
                      Team: {m.team_name} &middot; Season {m.uff_leagues?.season} &middot;{" "}
                      {m.uff_leagues?.status} &middot; <FactionTag faction={m.faction} />
                    </p>
                  </div>
                  {m.is_commissioner && (
                    <div className="text-right">
                      <p className="text-xs uppercase tracking-wide text-zinc-500">Join code</p>
                      <p className="font-mono text-lg" style={{ color: "#0057FF" }}>
                        {m.uff_leagues?.join_code}
                      </p>
                    </div>
                  )}
                </Link>
              ))}
            </div>
          )}
        </section>

        <div className="grid gap-6 sm:grid-cols-2">
          <section
            className="flex flex-col gap-3 rounded-lg border p-5"
            style={{ borderColor: "#2a2a40" }}
          >
            <h2 className="text-lg font-semibold" style={{ color: "#0057FF" }}>
              Create a League
            </h2>
            <form action={createLeague} className="flex flex-col gap-3">
              <input
                name="name"
                type="text"
                required
                placeholder="League name"
                className="rounded-md border px-3 py-2 text-sm"
                style={{ borderColor: "#2a2a40", background: "#15151f", color: "#f4f4f8" }}
              />
              <input
                name="teamName"
                type="text"
                required
                placeholder="Your team name"
                className="rounded-md border px-3 py-2 text-sm"
                style={{ borderColor: "#2a2a40", background: "#15151f", color: "#f4f4f8" }}
              />
              <div className="flex flex-col gap-1">
                <label htmlFor="maxTeams" className="text-xs uppercase tracking-wide text-zinc-400">
                  League size (must be even &mdash; split Hero/Villain)
                </label>
                <select
                  id="maxTeams"
                  name="maxTeams"
                  defaultValue="12"
                  className="rounded-md border px-3 py-2 text-sm"
                  style={{ borderColor: "#2a2a40", background: "#15151f", color: "#f4f4f8" }}
                >
                  {LEAGUE_SIZE_OPTIONS.map((n) => (
                    <option key={n} value={n}>
                      {n} teams
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor="faction" className="text-xs uppercase tracking-wide text-zinc-400">
                  Your faction
                </label>
                <select
                  id="faction"
                  name="faction"
                  defaultValue=""
                  className="rounded-md border px-3 py-2 text-sm"
                  style={{ borderColor: "#2a2a40", background: "#15151f", color: "#f4f4f8" }}
                >
                  <option value="">Decide later</option>
                  <option value="hero">Hero (AFC)</option>
                  <option value="villain">Villain (NFC)</option>
                </select>
              </div>
              