import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import PowerRankingsCard from "./PowerRankingsCard";

interface MatchupRow {
  matchup_id: number;
  member_id: string;
  points: number;
  is_complete: boolean;
  void_result: boolean;
}

interface MemberInfo {
  id: string;
  team_name: string;
  faction: "hero" | "villain" | null;
  profiles: { display_name: string | null; username: string } | null;
}

interface StandingRow {
  member: MemberInfo;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  pointsAgainst: number;
  rank: number;
}

const HERO_COLOR = "#0057FF";
const VILLAIN_COLOR = "#CC0000";

function factionColor(faction: "hero" | "villain" | null) {
  if (faction === "hero") return HERO_COLOR;
  if (faction === "villain") return VILLAIN_COLOR;
  return "#f4f4f8";
}

export default async function StandingsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: leagueId } = await params;
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: league } = await supabase
    .from("uff_leagues")
    .select("id, name, season, commissioner_id")
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

  const { data: members } = await supabase
    .from("league_members")
    .select("id, team_name, faction, profiles(display_name, username)")
    .eq("league_id", leagueId)
    .returns<MemberInfo[]>();

  const memberMap = Object.fromEntries((members ?? []).map((m) => [m.id, m]));

  // Fetch all matchup rows for this league
  const { data: matchupRows } = await supabase
    .from("uff_matchups")
    .select("matchup_id, member_id, points, is_complete, void_result")
    .eq("league_id", leagueId)
    .eq("season", league.season)
    .returns<MatchupRow[]>();

  // Group by matchup_id to find pairs, then calculate W/L
  const pairMap = new Map<number, MatchupRow[]>();
  for (const row of matchupRows ?? []) {
    if (!pairMap.has(row.matchup_id)) pairMap.set(row.matchup_id, []);
    pairMap.get(row.matchup_id)!.push(row);
  }

  const record: Record<
    string,
    { wins: number; losses: number; ties: number; pointsFor: number; pointsAgainst: number }
  > = {};

  for (const pair of pairMap.values()) {
    const [a, b] = pair;
    if (!a || !b) continue;
    if (!record[a.member_id]) record[a.member_id] = { wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgainst: 0 };
    if (!record[b.member_id]) record[b.member_id] = { wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgainst: 0 };

    record[a.member_id].pointsFor += a.points;
    record[a.member_id].pointsAgainst += b.points;
    record[b.member_id].pointsFor += b.points;
    record[b.member_id].pointsAgainst += a.points;

    if (a.is_complete && b.is_complete) {
      if (a.points > b.points) {
        record[a.member_id].wins++;
        // Insurance (token 11): b's loss is voided if void_result is set
        if (!b.void_result) record[b.member_id].losses++;
      } else if (b.points > a.points) {
        record[b.member_id].wins++;
        // Insurance (token 11): a's loss is voided if void_result is set
        if (!a.void_result) record[a.member_id].losses++;
      } else {
        record[a.member_id].ties++;
        record[b.member_id].ties++;
      }
    }
  }

  // Build sorted standings
  const standings: StandingRow[] = Object.entries(memberMap).map(([id, member]) => ({
    member,
    ...(record[id] ?? { wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgainst: 0 }),
    rank: 0,
  }));

  standings.sort((a, b) => {
    if (b.wins !== a.wins) return b.wins - a.wins;
    return b.pointsFor - a.pointsFor;
  });

  standings.forEach((row, i) => { row.rank = i + 1; });

  const hasGames = standings.some((s) => s.wins + s.losses + s.ties > 0);

  return (
    <div className="min-h-screen px-6 py-12 sm:px-12" style={{ background: "#0d0d1a", color: "#f4f4f8" }}>
      <main className="mx-auto flex max-w-3xl flex-col gap-8">
        <header className="flex flex-col gap-2">
          <Link href={`/dashboard/league/${leagueId}`} className="text-sm underline" style={{ color: "#0057FF" }}>
            &larr; Back to {league.name}
          </Link>
          <p className="text-sm uppercase tracking-[0.3em]" style={{ color: "#FFD700" }}>
            Ultimate Fantasy Football
          </p>
          <h1 className="text-3xl sm:text-4xl" style={{ fontFamily: "var(--font-display, sans-serif)", color: "#0057FF" }}>
            Standings
          </h1>
          <p className="text-sm text-white">Season {league.season} · Regular season W/L record</p>
        </header>

        {!hasGames ? (
          <div className="rounded-lg border p-5 text-sm text-white" style={{ borderColor: "#2a2a40" }}>
            No finalized games yet. Standings will appear after the commissioner finalizes each week&rsquo;s matchups.
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {/* Header row — mobile: 4 cols (no PA), sm+: 5 cols */}
            <div
              className="grid grid-cols-[auto_1fr_auto_auto_auto] sm:grid-cols-[auto_1fr_auto_auto_auto_auto] items-center gap-2 sm:gap-3 px-4 py-2 text-xs uppercase tracking-wide text-white"
            >
              <span className="w-6 text-center">#</span>
              <span>Team</span>
              <span className="w-14 sm:w-20 text-center">W–L–T</span>
              <span className="w-12 text-center">Win%</span>
              <span className="w-14 sm:w-16 text-right">PF</span>
              <span className="hidden sm:inline sm:w-20 sm:text-right">PA</span>
            </div>

            {standings.map((row) => {
              const isMe = row.member.id === me.id;
              const color = factionColor(row.member.faction);
              const record = `${row.wins}–${row.losses}${row.ties > 0 ? `–${row.ties}` : ""}`;
              const totalGames = row.wins + row.losses + row.ties;
              const winPct = totalGames > 0 ? Math.round((row.wins / totalGames) * 100) : null;
              return (
                <div
                  key={row.member.id}
                  className="grid grid-cols-[auto_1fr_auto_auto_auto] sm:grid-cols-[auto_1fr_auto_auto_auto_auto] items-center gap-2 sm:gap-3 rounded-lg border px-4 py-3"
                  style={{
                    borderColor: isMe ? "#FFD700" : "#2a2a40",
                    background: isMe ? "rgba(255,215,0,0.04)" : "#0d0d1a",
                  }}
                >
                  {/* Rank */}
                  <span
                    className="w-6 text-center text-sm font-bold tabular-nums"
                    style={{ color: row.rank === 1 ? "#FFD700" : "#f4f4f8" }}
                  >
                    {row.rank}
                  </span>

                  {/* Team name + faction */}
                  <div className="min-w-0">
                    <p className="font-semibold truncate" style={{ color: isMe ? "#FFD700" : "#f4f4f8" }}>
                      {row.member.team_name}
                      {isMe && <span className="ml-1 text-xs font-normal text-white">(you)</span>}
                    </p>
                    <p className="text-xs truncate" style={{ color }}>
                      {row.member.faction ?? "Unassigned"}
                      {" · "}
                      <span className="text-white">
                        {row.member.profiles?.display_name ?? row.member.profiles?.username ?? ""}
                      </span>
                    </p>
                  </div>

                  {/* W–L–T */}
                  <span className="w-14 sm:w-20 text-center text-sm font-semibold tabular-nums" style={{ color: "#f4f4f8" }}>
                    {record}
                  </span>

                  {/* Win% */}
                  <span className="w-12 text-center text-sm tabular-nums" style={{ color: "#8888aa" }}>
                    {winPct !== null ? `${winPct}%` : "—"}
                  </span>

                  {/* Points For */}
                  <span className="w-14 sm:w-16 text-right text-sm tabular-nums text-white">
                    {row.pointsFor.toFixed(2)}
                  </span>

                  {/* Points Against — hidden on mobile */}
                  <span className="hidden sm:inline sm:w-20 sm:text-right text-sm tabular-nums text-white">
                    {row.pointsAgainst.toFixed(2)}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {/* Power Rankings — AI true-strength ranking */}
        {hasGames && (
          <PowerRankingsCard leagueId={leagueId} />
        )}

        {/* Hero vs Villain breakdown */}
        {hasGames && (
          <section className="rounded-lg border p-5 flex flex-col gap-4" style={{ borderColor: "#2a2a40" }}>
            <h2 className="text-lg font-semibold" style={{ color: "#FFD700" }}>Faction War</h2>
            {(["hero", "villain"] as const).map((faction) => {
              const factionRows = standings.filter((s) => s.member.faction === faction);
              const totalWins = factionRows.reduce((acc, r) => acc + r.wins, 0);
              const totalLosses = factionRows.reduce((acc, r) => acc + r.losses, 0);
              const totalPF = factionRows.reduce((acc, r) => acc + r.pointsFor, 0);
              return (
                <div key={faction} className="flex items-center justify-between text-sm">
                  <span className="font-semibo