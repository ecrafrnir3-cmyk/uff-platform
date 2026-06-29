import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import FreeAgents from "./FreeAgents";
import { getCurrentNFLWeek } from "@/lib/nfl-utils";

const FLAG_KEYS = new Set([
  "pts_allow_0","pts_allow_1_6","pts_allow_7_13","pts_allow_14_20",
  "pts_allow_21_27","pts_allow_28_34","pts_allow_35p",
]);

function calcProjected(
  stats: Record<string, number>,
  settings: Record<string, number>
): number {
  let score = 0;
  for (const [key, multiplier] of Object.entries(settings)) {
    const val = stats[key];
    if (val == null || val === 0) continue;
    score += FLAG_KEYS.has(key) ? multiplier : val * multiplier;
  }
  return Math.round(score * 100) / 100;
}

export default async function FreeAgentsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; added?: string; dropped?: string }>;
}) {
  const { id: leagueId } = await params;
  const { error, added, dropped } = await searchParams;
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: league } = await supabase
    .from("uff_leagues")
    .select("id, name, season, scoring_settings, draft_rounds, ir_spots, faab_budget, max_adds_per_week, max_adds_per_season")
    .eq("id", leagueId)
    .maybeSingle();

  if (!league) redirect("/dashboard?error=" + encodeURIComponent("League not found."));

  const { data: me } = await supabase
    .from("league_members")
    .select("id, eliminated_at")
    .eq("league_id", leagueId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!me) redirect("/dashboard?error=" + encodeURIComponent("You're not a member of that league."));

  // My roster counts
  const { data: myRosterRaw } = await supabase
    .from("uff_roster_players")
    .select("player_id, slot, players(full_name, position)")
    .eq("member_id", me.id)
    .is("dropped_at", null);

  const myRoster = (myRosterRaw ?? []) as unknown as {
    player_id: string;
    slot: string;
    players: { full_name: string; position: string | null } | null;
  }[];

  const myActiveCount = myRoster.filter((r) => r.slot === "active").length;
  const myIRCount = myRoster.filter((r) => r.slot === "ir").length;
  const rosterFull = myActiveCount >= league.draft_rounds;

  const myActiveRoster = myRoster
    .filter((r) => r.slot === "active")
    .map((r) => ({
      player_id: r.player_id,
      full_name: r.players?.full_name ?? r.player_id,
      position:  r.players?.position ?? null,
    }));

  // All rostered player IDs in this league (direct league_id column - - no join needed)
  const { data: allRostered } = await supabase
    .from("uff_roster_players")
    .select("player_id")
    .eq("league_id", leagueId)
    .is("dropped_at", null);

  const rosteredIds = new Set((allRostered ?? []).map((r) => r.player_id));

  // Fetch Sleeper projections for current week (best-effort - silent fail off-season)
  const week = getCurrentNFLWeek();
  const season = league.season ?? "2026";
  let projMap: Record<string, number> = {};

  try {
    const projRes = await fetch(
      `https://api.sleeper.app/v1/projections/nfl/${season}/${week}?season_type=regular`,
      { next: { revalidate: 3600 } } // cache 1hr
    );
    if (projRes.ok) {
      const projData: Record<string, Record<string, number>> = await projRes.json();
      const settings: Record<string, number> = league.scoring_settings ?? {};
      for (const [playerId, stats] of Object.entries(projData)) {
        const pts = calcProjected(stats, settings);
        if (pts > 0) projMap[playerId] = pts;
      }
    }
  } catch {
    // Off-season / network issue - projections unavailable, show 0
  }

  const hasProjections = Object.keys(projMap).length > 0;

  // FAAB data — only needed when FAAB is enabled for this league
  const faabEnabled = (league.faab_budget ?? 0) > 0;
  let myBalance = 0;
  let myBids: { id: string; player_id: string; bid_amount: number; drop_player_id: string | null; status: string }[] = [];

  if (faabEnabled) {
    // Get user's current FAAB balance
    const { data: memberFaab } = await supabase
      .from("league_members")
      .select("faab_balance")
      .eq("id", me.id)
      .maybeSingle();
    myBalance = memberFaab?.faab_balance ?? (league.faab_budget ?? 0);

    // Get user's pending bids for this week
    const { data: bidsRaw } = await supabase
      .from("uff_waiver_bids")
      .select("id, player_id, bid_amount, drop_player_id, status")
      .eq("league_id", leagueId)
      .eq("member_id", me.id)
      .eq("week", week)
      .eq("status", "pending");
    myBids = bidsRaw ?? [];
  }

  // Acquisition limit tracking
  const maxAddsPerWeek   = league.max_adds_per_week   ?? 0;
  const maxAddsPerSeason = league.max_adds_per_season ?? 0;
  let weekAddCount   = 0;
  let seasonAddCount = 0;
  if (maxAddsPerWeek > 0 || maxAddsPerSeason > 0) {
    const { data: addRows } = await supabase
      .from("uff_roster_players")
      .select("week_added")
      .eq("member_id", me.id)
      .not("week_added", "is", null)
      .gt("week_added", 0);
    const rows = addRows ?? [];
    weekAddCount   = rows.filter((r) => r.week_added === week).length;
    seasonAddCount = rows.length;
  }

  // Fetch player names for any pending bid player IDs (covers players outside the visible filter list)
  const bidPlayerNames: Record<string, string> = {};
  if (myBids.length > 0) {
    const bidPlayerIds = myBids.map((b) => b.player_id);
    const { data: bidPlayers } = await supabase
      .from("players")
      .select("id, full_name")
      .in("id", bidPlayerIds);
    for (const p of bidPlayers ?? []) bidPlayerNames[p.id] = p.full_name;
  }

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
            Free Agents
          </h1>
          <div className="flex flex-wrap gap-4 text-sm text-white">
            <span>
              Active roster:{" "}
              <span className="font-semibold" style={{ color: rosterFull ? "#CC0000" : "#f4f4f8" }}>
                {myActiveCount} / {league.draft_rounds}
              </span>
            </span>
            <span>
              IR:{" "}
              <span className="font-semibold" style={{ color: "#f4f4f8" }}>
                {myIRCount} / {league.ir_spots}
              </span>
            </span>
            {faabEnabled && (
              <span>
                FAAB:{" "}
                <span className="font-semibold" style={{ color: "#FFD700" }}>
                  ${myBalance} remaining
                </span>
              </span>
            )}
            {maxAddsPerWeek > 0 && (
              <span>
                Adds this week:{" "}
                <span className="font-semibold" style={{ color: weekAddCount >= maxAddsPerWeek ? "#CC0000" : "#f4f4f8" }}>
                  {weekAddCount} / {maxAddsPerWeek}
                </span>
              </span>
            )}
            {maxAddsPerSeason > 0 && (
              <span>
                Adds this season:{" "}
                <span className="font-semibold" style={{ color: seasonAddCount >= maxAddsPerSeason ? "#CC0000" : "#f4f4f8" }}>
                  {seasonAddCount} / {maxAddsPerSeason}
                </span>
              </span>
            )}
            {!hasProjections && (
              <span style={{ color: "#f4f4f8" }}>
                Projections available once the season starts (Sept 9)
              </span>
            )}
          </div>
        </header>

        {error && (
          <p className="rounded-md border px-3 py-2 text-sm" style={{ borderColor: "#CC0000", color: "#ff8a8a", background: "#1a0e16" }}>
            {decodeURIComponent(error)}
          </p>
        )}
        {added && (
          <p className="rounded-md border px-3 py-2 text-sm" style={{ borderColor: "#3DDC84", color: "#3DDC84", background: "#0e1a12" }}>
            Player added to your roster.
          </p>
        )}
        {dropped && (
          <p className="rounded-md border px-3 py-2 text-sm" style={{ borderColor: "#3DDC84", color: "#3DDC84", background: "#0e1a12" }}>
            Player released to free agency.
          </p>
        )}

        {me.eliminated_at && (
          <div
            className="rounded-xl border px-5 py-4 text-center"
            style={{ borderColor: "#CC0000", background: "rgba(204,0,0,0.08)", color: "#ff8a8a" }}
          >
            <p className="text-base font-bold uppercase tracking-wide" style={{ color: "#CC0000" }}>
              🔒 Roster Locked — Eliminated from Playoffs
            </p>
            <p className="mt-1 text-sm" style={{ color: "#f4f4f8" }}>
              Your team was eliminated. You can still view free agents, but adds, drops, and waiver bids are disabled.
            </p>
          </div>
        )}

        <FreeAgents
          leagueId={leagueId}
          rosteredIds={[...rosteredIds]}
          projMap={projMap}
          hasProjections={hasProjections}
          rosterFull={rosterFull}
          maxActive={league.draft_rounds}
          week={week}
          myActiveRoster={myActiveRoster}
          faabEnabled={faabEnabled}
          myBalance={myBalance}
          myBids={myBids}
          bidPlayerNames={bidPlayerNames}
          isEliminated={!!me.eliminated_at}
        />
      </main>
    </div>
  );
}
