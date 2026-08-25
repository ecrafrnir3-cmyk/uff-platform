import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createLeague, joinLeague } from "./actions";
import { LEAGUE_SIZE_OPTIONS } from "./constants";
import PushNotificationsCard from "./PushNotificationsCard";
import SubmitButton from "@/components/SubmitButton";

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
  return <span className="text-white">No faction yet</span>;
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
            <div
              className="flex flex-col items-center gap-5 rounded-xl border-2 border-dashed py-10 px-6 text-center"
              style={{ borderColor: "#2a2a40" }}
            >
              <span className="text-4xl select-none">⚔️</span>
              <div className="flex flex-col gap-2 max-w-sm">
                <p className="text-base font-semibold" style={{ color: "#f4f4f8" }}>
                  No leagues yet
                </p>
                <p className="text-sm leading-relaxed" style={{ color: "#a0a0c0" }}>
                  UFF is fantasy football with faction warfare, weekly power tokens, and live
                  scoring. Create your first league or ask your commissioner for a join code.
                </p>
              </div>
              <div className="flex flex-wrap justify-center gap-2">
                <span
                  className="rounded-full px-3 py-1 text-xs font-semibold"
                  style={{ background: "rgba(0,87,255,0.15)", color: HERO_COLOR }}
                >
                  Hero vs Villain factions
                </span>
                <span
                  className="rounded-full px-3 py-1 text-xs font-semibold"
                  style={{ background: "rgba(255,215,0,0.12)", color: "#FFD700" }}
                >
                  ⚡ 18 weekly power tokens
                </span>
                <span
                  className="rounded-full px-3 py-1 text-xs font-semibold"
                  style={{ background: "rgba(61,220,132,0.12)", color: "#3DDC84" }}
                >
                  📡 Live scoring
                </span>
              </div>
              <p className="text-xs" style={{ color: "#a0a0c0" }}>↓ Get started below</p>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {leagues.map((m) => (
                <Link
                  key={m.uff_leagues?.id}
                  href={`/dashboard/league/${m.uff_leagues?.id}`}
                  className="flex items-center justify-between rounded-lg border px-4 py-3 transition hover:border-white"
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
                    <p className="text-sm text-white">
                      Team: {m.team_name} &middot; Season {m.uff_leagues?.season} &middot;{" "}
                      {m.uff_leagues?.status} &middot; <FactionTag faction={m.faction} />
                    </p>
                  </div>
                  {m.is_commissioner && (
                    <div className="text-right">
                      <p className="text-xs uppercase tracking-wide text-white">Join code</p>
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

        <PushNotificationsCard />

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
                <label htmlFor="maxTeams" className="text-xs uppercase tracking-wide text-white">
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
                <label htmlFor="faction" className="text-xs uppercase tracking-wide text-white">
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
              <SubmitButton
                pendingLabel="Creating…"
                className="rounded-md px-4 py-2 text-sm font-semibold"
                style={{ background: "#0057FF", color: "#f4f4f8" }}
              >
                Create league
              </SubmitButton>
            </form>
          </section>

          <section
            className="flex flex-col gap-3 rounded-lg border p-5"
            style={{ borderColor: "#2a2a40" }}
          >
            <h2 className="text-lg font-semibold" style={{ color: "#0057FF" }}>
              Join a League
            </h2>
            <form action={joinLeague} className="flex flex-col gap-3">
              <input
                name="joinCode"
                type="text"
                required
                placeholder="Join code (e.g. AB12CD)"
                className="rounded-md border px-3 py-2 text-sm uppercase"
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
                <label htmlFor="joinFaction" className="text-xs uppercase tracking-wide text-white">
                  Your faction
                </label>
                <select
                  id="joinFaction"
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
              <SubmitButton
                pendingLabel="Joining…"
                className="rounded-md px-4 py-2 text-sm font-semibold"
                style={{ background: "#CC0000", color: "#f4f4f8" }}
              >
                Join league
              </SubmitButton>
            </form>
          </section>
        </div>

        {/* Footer links */}
        <footer className="flex justify-center gap-6 pt-4 border-t" style={{ borderColor: "#2a2a40" }}>
          <Link href="/about" className="text-xs hover:underline" style={{ color: "#8888aa" }}>
            About UFF
          </Link>
          <Link href="/guide" className="text-xs hover:underline" style={{ color: "#8888aa" }}>
            Rules &amp; Guide
          </Link>
        </footer>
      </main>
    </div>
  );
}
