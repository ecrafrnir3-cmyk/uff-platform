import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

interface MatchupRow {
  matchup_id: number;
  member_id: string;
  week: number;
  points: number;
  is_complete: boolean;
  season: string;
}

interface MemberRow {
  id: string;
  team_name: string;
  faction: "hero" | "villain" | null;
  profiles: { display_name: string | null; username: string } | null;
}

export default async function H2HPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ a?: string; b?: string }>;
}) {
  const { id: leagueId } = await params;
  const { a: memberAId, b: memberBId } = await searchParams;
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: league } = await supabase
    .from("uff_leagues")
    .select("id, name, season")
    .eq("id", leagueId)
    .maybeSingle();
  if (!league) redirect("/dashboard?error=" + encodeURIComponent("League not found."));

  const { data: me } = await supabase
    .from("league_members")
    .select("id")
    .eq("league_id", leagueId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!me) redirect("/dashboard?error=" + encodeURIComponent("You're not a member of that league."));

  const { data: allMembers } = await supabase
    .from("league_members")
    .select("id, team_name, faction, profiles(display_name, username)")
    .eq("league_id", leagueId)
    .returns<MemberRow[]>();

  const members = allMembers ?? [];
  const memberMap: Record<string, MemberRow> = {};
  for (const m of members) memberMap[m.id] = m;

  // If no selection yet, show the picker UI
  if (!memberAId || !memberBId || memberAId === memberBId) {
    return (
      <div className="min-h-screen px-6 py-12 sm:px-12" style={{ background: "#0d0d1a", color: "#f4f4f8" }}>
        <main className="mx-auto max-w-2xl flex flex-col gap-8">
          <header className="flex flex-col gap-2">
            <Link href={`/dashboard/league/${leagueId}/managers`} className="text-sm underline" style={{ color: "#0057FF" }}>
              &larr; Back to Managers
            </Link>
            <p className="text-sm uppercase tracking-[0.3em]" style={{ color: "#FFD700" }}>
              Ultimate Fantasy Football
            </p>
            <h1 className="text-3xl sm:text-4xl" style={{ fontFamily: "var(--font-display, sans-serif)", color: "#0057FF" }}>
              Head-to-Head
            </h1>
            <p className="text-sm text-white">All-time head-to-head record between two managers.</p>
          </header>

          <form method="GET" className="flex flex-col gap-5 rounded-lg border p-6" style={{ borderColor: "#2a2a40" }}>
            <div className="flex flex-col gap-2">
              <label className="text-sm font-semibold text-white">Team A</label>
              <select name="a" required
                className="rounded-md border px-3 py-2 text-sm"
                style={{ borderColor: "#2a2a40", background: "#15151f", color: "#f4f4f8" }}
                defaultValue={memberAId ?? ""}
              >
                <option value="">Select a team...</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>{m.team_name}</option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-sm font-semibold text-white">Team B</label>
              <select name="b" required
                className="rounded-md border px-3 py-2 text-sm"
                style={{ borderColor: "#2a2a40", background: "#15151f", color: "#f4f4f8" }}
                defaultValue={memberBId ?? ""}
              >
                <option value="">Select a team...</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>{m.team_name}</option>
                ))}
              </select>
            </div>
            <button type="submit"
              className="self-end rounded-md px-5 py-2 text-sm font-semibold"
              style={{ background: "#0057FF", color: "#fff" }}
            >
              Compare →
            </button>
          </form>
        </main>
      </div>
    );
  }

  // Fetch all matchups for this season involving these two members
  const { data: matchupRows } = await supabase
    .from("uff_matchups")
    .select("matchup_id, member_id, week, points, is_complete, season")
    .eq("league_id", leagueId)
    .in("member_id", [memberAId, memberBId])
    .eq("is_complete", true)
    .order("week", { ascending: true })
    .returns<MatchupRow[]>();

  // Find weeks where both these members played each other
  // They share the same matchup_id in the same week
  const byWeekMatchup = new Map<string, MatchupRow[]>();
  for (const row of matchupRows ?? []) {
    const key = `${row.season}_${row.week}_${row.matchup_id}`;
    if (!byWeekMatchup.has(key)) byWeekMatchup.set(key, []);
    byWeekMatchup.get(key)!.push(row);
  }

  // Only keep weeks where BOTH members appear in the same matchup_id
  const h2hWeeks: { week: number; season: string; aRow: MatchupRow; bRow: MatchupRow }[] = [];
  for (const [, pair] of byWeekMatchup) {
    if (pair.length === 2) {
      const aRow = pair.find((r) => r.member_id === memberAId);
      const bRow = pair.find((r) => r.member_id === memberBId);
      if (aRow && bRow) {
        h2hWeeks.push({ week: aRow.week, season: aRow.season, aRow, bRow });
      }
    }
  }

  h2hWeeks.sort((x, y) => x.week - y.week);

  const memberA = memberMap[memberAId];
  const memberB = memberMap[memberBId];

  let aWins = 0, bWins = 0, ties = 0;
  let aTotalPts = 0, bTotalPts = 0;
  let aHighGame = 0, bHighGame = 0;

  for (const { aRow, bRow } of h2hWeeks) {
    aTotalPts += aRow.points;
    bTotalPts += bRow.points;
    if (aRow.points > bRow.points) aWins++;
    else if (bRow.points > aRow.points) bWins++;
    else ties++;
    if (aRow.points > aHighGame) aHighGame = aRow.points;
    if (bRow.points > bHighGame) bHighGame = bRow.points;
  }

  const totalGames = h2hWeeks.length;
  const aAvg = totalGames > 0 ? aTotalPts / totalGames : 0;
  const bAvg = totalGames > 0 ? bTotalPts / totalGames : 0;

  function factionColor(f: string | null) {
    if (f === "hero") return "#0057FF";
    if (f === "villain") return "#CC0000";
    return "#8888aa";
  }

  return (
    <div className="min-h-screen px-6 py-12 sm:px-12" style={{ background: "#0d0d1a", color: "#f4f4f8" }}>
      <main className="mx-auto max-w-2xl flex flex-col gap-8">
        <header className="flex flex-col gap-2">
          <Link href={`/dashboard/league/${leagueId}/h2h`} className="text-sm underline" style={{ color: "#0057FF" }}>
            &larr; Change matchup
          </Link>
          <p className="text-sm uppercase tracking-[0.3em]" style={{ color: "#FFD700" }}>
            Ultimate Fantasy Football
          </p>
          <h1 className="text-3xl sm:text-4xl" style={{ fontFamily: "var(--font-display, sans-serif)", color: "#0057FF" }}>
            Head-to-Head
          </h1>
        </header>

        {/* Season summary */}
        <section className="rounded-lg border p-5 flex flex-col gap-4" style={{ borderColor: "#2a2a40" }}>
          <div className="grid grid-cols-3 items-center gap-2 text-center">
            {/* Team A */}
            <div className="flex flex-col gap-1">
              <p className="font-bold text-base" style={{ color: "#f4f4f8" }}>{memberA?.team_name ?? "Team A"}</p>
              <p className="text-xs" style={{ color: factionColor(memberA?.faction ?? null) }}>
                {memberA?.faction ?? "—"}
              </p>
              <p className="text-4xl font-black mt-1" style={{ color: aWins > bWins ? "#3DDC84" : "#8888aa" }}>
                {aWins}
              </p>
              <p className="text-xs text-white">wins</p>
            </div>
            {/* vs */}
            <div className="flex flex-col items-center gap-1">
              <span className="text-xs font-semibold" style={{ color: "#8888aa" }}>
                {totalGames === 0 ? "No H2H" : `${totalGames} game${totalGames !== 1 ? "s" : ""}`}
              </span>
              <span className="text-lg" style={{ color: "#FFD700" }}>VS</span>
              {ties > 0 && <span className="text-xs text-white">{ties} tie{ties !== 1 ? "s" : ""}</span>}
            </div>
            {/* Team B */}
            <div className="flex flex-col gap-1">
              <p className="font-bold text-base" style={{ color: "#f4f4f8" }}>{memberB?.team_name ?? "Team B"}</p>
              <p className="text-xs" style={{ color: factionColor(memberB?.faction ?? null) }}>
                {memberB?.faction ?? "—"}
              </p>
              <p className="text-4xl font-black mt-1" style={{ color: bWins > aWins ? "#3DDC84" : "#8888aa" }}>
                {bWins}
              </p>
              <p className="text-xs text-white">wins</p>
            </div>
          </div>

          {totalGames > 0 && (
            <div className="grid grid-cols-3 gap-2 text-center text-xs pt-3 border-t" style={{ borderColor: "#2a2a40" }}>
              <div>
                <p className="font-bold text-sm" style={{ color: "#f4f4f8" }}>{aTotalPts.toFixed(1)}</p>
                <p style={{ color: "#8888aa" }}>Total PF</p>
              </div>
              <div>
                <p className="font-bold text-sm" style={{ color: "#f4f4f8" }}>{aAvg.toFixed(1)}</p>
                <p style={{ color: "#8888aa" }}>Avg / game</p>
              </div>
              <div>
                <p className="font-bold text-sm" style={{ color: "#f4f4f8" }}>{aHighGame.toFixed(1)}</p>
                <p style={{ color: "#8888aa" }}>Best game</p>
              </div>
            </div>
          )}
          {totalGames > 0 && (
            <div className="grid grid-cols-3 gap-2 text-center text-xs" style={{ marginTop: -8 }}>
              <div>
                <p className="font-bold text-sm" style={{ color: "#f4f4f8" }}>{bTotalPts.toFixed(1)}</p>
                <p style={{ color: "#8888aa" }}>Total PF</p>
              </div>
              <div>
                <p className="font-bold text-sm" style={{ color: "#f4f4f8" }}>{bAvg.toFixed(1)}</p>
                <p style={{ color: "#8888aa" }}>Avg / game</p>
              </div>
              <div>
                <p className="font-bold text-sm" style={{ color: "#f4f4f8" }}>{bHighGame.toFixed(1)}</p>
                <p style={{ color: "#8888aa" }}>Best game</p>
              </div>
            </div>
          )}
        </section>

        {/* Game log */}
        {totalGames === 0 ? (
          <div className="rounded-lg border p-6 text-center text-sm text-white" style={{ borderColor: "#2a2a40" }}>
            These teams haven't played each other yet.
          </div>
        ) : (
          <section className="flex flex-col gap-3">
            <h2 className="font-semibold text-lg" style={{ color: "#FFD700" }}>Game Log</h2>
            <div className="flex flex-col gap-2">
              {h2hWeeks.map(({ week, aRow, bRow }) => {
                const aWon = aRow.points > bRow.points;
                const bWon = bRow.points > aRow.points;
                return (
                  <div key={week}
                    className="flex items-center gap-3 rounded-lg border px-4 py-3"
                    style={{ borderColor: "#2a2a40" }}
                  >
                    <span className="text-xs font-semibold shrink-0" style={{ color: "#8888aa" }}>Wk {week}</span>
                    <div className="flex-1 min-w-0 flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold truncate" style={{ color: aWon ? "#3DDC84" : "#8888aa" }}>
                        {memberA?.team_name ?? "A"}
                      </span>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="font-bold tabular-nums text-sm" style={{ color: aWon ? "#3DDC84" : "#f4f4f8" }}>
                          {aRow.points.toFixed(2)}
                        </span>
                        <span style={{ color: "#8888aa" }}>—</span>
                        <span className="font-bold tabular-nums text-sm" style={{ color: bWon ? "#3DDC84" : "#f4f4f8" }}>
                          {bRow.points.toFixed(2)}
                        </span>
                      </div>
                      <span className="text-sm font-semibold truncate text-right" style={{ color: bWon ? "#3DDC84" : "#8888aa" }}>
                        {memberB?.team_name ?? "B"}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
