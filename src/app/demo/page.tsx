import {
  DEMO_LEAGUE_ID,
  DEMO_WEEK,
  getLeague,
  getMatchups,
  getRosters,
  getUsers,
} from "@/lib/data";
import { buildMatchupViews, generateOracleRecap } from "@/lib/oracle";

export default async function DemoPage() {
  const [league, users, rosters, matchups] = await Promise.all([
    getLeague(DEMO_LEAGUE_ID),
    getUsers(DEMO_LEAGUE_ID),
    getRosters(DEMO_LEAGUE_ID),
    getMatchups(DEMO_LEAGUE_ID, DEMO_WEEK),
  ]);

  const views = buildMatchupViews(rosters, users, matchups);
  const recap = generateOracleRecap(league, views);

  return (
    <div
      className="min-h-screen px-6 py-12 sm:px-12"
      style={{ background: "#0d0d1a", color: "#f4f4f8" }}
    >
      <main className="mx-auto flex max-w-3xl flex-col gap-8">
        <header className="flex flex-col gap-2">
          <p className="text-sm uppercase tracking-[0.3em]" style={{ color: "#FFD700" }}>
            Ultimate Fantasy Football
          </p>
          <h1
            className="text-4xl sm:text-5xl"
            style={{ fontFamily: "var(--font-display, sans-serif)", color: "#0057FF" }}
          >
            {league.name}
          </h1>
          <p className="text-sm text-zinc-400">
            Season {league.season} &middot; Week {DEMO_WEEK} matchups
          </p>
        </header>

        <section className="flex flex-col gap-4">
          {views.map((v) => (
            <div
              key={v.matchupId}
              className="flex items-center justify-between rounded-lg border px-4 py-3"
              style={{ borderColor: "#2a2a40" }}
            >
              <div>
                <p
                  className="font-semibold"
                  style={{ color: v.winner.rosterId === v.teamA.rosterId ? "#0057FF" : "#f4f4f8" }}
                >
                  {v.teamA.teamName} <span className="text-zinc-500">({v.teamA.record})</span>
                </p>
                <p
                  className="font-semibold"
                  style={{ color: v.winner.rosterId === v.teamB.rosterId ? "#0057FF" : "#f4f4f8" }}
                >
                  {v.teamB.teamName} <span className="text-zinc-500">({v.teamB.record})</span>
                </p>
              </div>
              <div className="text-right tabular-nums">
                <p className="font-mono">{v.teamA.points.toFixed(2)}</p>
                <p className="font-mono">{v.teamB.points.toFixed(2)}</p>
              </div>
            </div>
          ))}
        </section>

        <section
          className="flex flex-col gap-3 rounded-lg border p-5"
          style={{ borderColor: "#CC0000", background: "#1a0e16" }}
        >
          <h2 className="text-xl font-semibold" style={{ color: "#FFD700" }}>
            The Oracle&rsquo;s Calls
          </h2>
          {recap.map((line, i) => (
            <p key={i} className="text-sm leading-relaxed text-zinc-200">
              {line}
            </p>
          ))}
        </section>

        <footer className="text-xs text-zinc-500">
          Data: Sleeper API (demo league {DEMO_LEAGUE_ID}, 2018 season — swap in a live league
          when ready). Oracle reactions are rule-based v0; next step wires in Claude Haiku.
        </footer>
      </main>
    </div>
  );
}
