import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createLeague, joinLeague, signOut } from "./actions";

interface LeagueRow {
  team_name: string;
  is_commissioner: boolean;
  uff_leagues: {
    id: string;
    name: string;
    season: string;
    join_code: string;
    status: string;
    max_teams: number;
  } | null;
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
    .select("team_name, is_commissioner, uff_leagues(id, name, season, join_code, status, max_teams)")
    .eq("user_id", user.id)
    .returns<LeagueRow[]>();

  const leagues = memberships ?? [];

  return (
    <div
      className="min-h-screen px-6 py-12 sm:px-12"
      style={{ background: "#0d0d1a", color: "#f4f4f8" }}
    >
      <main className="mx-auto flex max-w-3xl flex-col gap-8">
        <header className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm uppercase tracking-[0.3em]" style={{ color: "#FFD700" }}>
              Ultimate Fantasy Football
            </p>
            <h1
              className="mt-1 text-3xl sm:text-4xl"
              style={{ fontFamily: "var(--font-display, sans-serif)", color: "#0057FF" }}
            >
              Welcome, {profile?.display_name ?? profile?.username ?? user.email}
            </h1>
          </div>
          <form action={signOut}>
            <button
              type="submit"
              className="rounded-md border px-3 py-2 text-sm"
              style={{ borderColor: "#2a2a40", color: "#f4f4f8" }}
            >
              Sign out
            </button>
          </form>
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
                <div
                  key={m.uff_leagues?.id}
                  className="flex items-center justify-between rounded-lg border px-4 py-3"
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
                      {m.uff_leagues?.status}
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
                </div>
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
              <button
                type="submit"
                className="rounded-md px-4 py-2 text-sm font-semibold"
                style={{ background: "#0057FF", color: "#f4f4f8" }}
              >
                Create league
              </button>
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
              <button
                type="submit"
                className="rounded-md px-4 py-2 text-sm font-semibold"
                style={{ background: "#CC0000", color: "#f4f4f8" }}
              >
                Join league
              </button>
            </form>
          </section>
        </div>
      </main>
    </div>
  );
}
