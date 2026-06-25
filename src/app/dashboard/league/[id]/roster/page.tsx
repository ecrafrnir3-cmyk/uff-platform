import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { moveFromIR, moveToIR, useRestoreChip } from "../player-actions";
import { respondToTrade, cancelTrade } from "../trade-actions";
import DragDropLineup from "./DragDropLineup";
import TokenChoicePicker from "./TokenChoicePicker";
import DropButton from "./DropButton";
import TokenAdvisor from "./TokenAdvisor";
import { getCurrentNFLWeek, isLineupLocked, getWeekLockTime } from "@/lib/nfl-utils";

interface GameScheduleRow { team: string; kickoff_utc: string; }

// ─── Types ───────────────────────────────────────────────────────────────────
interface RosterRow {
  id: string;
  added_at: string;
  player_id: string;
  slot: string;
  players: {
    id: string;
    full_name: string;
    position: string | null;
    team: string | null;
    status: string | null;
  } | null;
}
interface TeamFactionRow { abbr: string; faction: "hero" | "villain"; }
interface PowerRow {
  id: string;
  round: number;
  draft_powers: { name: string; category: string | null; description: string } | null;
  team_active_powers: { status: string }[] | null;
}
interface ChipRow { id: string; earned_week: number; used: boolean; }
interface NegatedPlayerRow {
  player_id: string;
  players: { full_name: string } | null;
  restored_at: string | null;
}
interface PlayerPowerRow {
  player_id: string;
  power: string;
}
interface TradeRow {
  id: string;
  proposer_id: string;
  receiver_id: string;
  proposer_player_ids: string[];
  receiver_player_ids: string[];
  status: string;
  created_at: string;
}
// ─── Constants ───────────────────────────────────────────────────────────────
const HERO_COLOR    = "#0057FF";
const VILLAIN_COLOR = "#CC0000";

const TOKEN_INFO: Record<number, { name: string; effect: string }> = {
  1:  { name: "Power Surge",      effect: "+2.0 flat points added to your score this week." },
  2:  { name: "Triple Threat",    effect: "Your kicker's points are tripled this week." },
  3:  { name: "Bench Vault",      effect: "Your highest-scoring bench player's points are added to your score on top of starters." },
  4:  { name: "Mulligan",         effect: "After games, your worst underperforming starter is retroactively swapped with the best eligible bench player who outscored them." },
  5:  { name: "Mirror Match",     effect: "Your score gains a bonus equal to the total extra points your opponent's draft powers generated for them this week." },
  6:  { name: "Faction Surge",    effect: "Your Faction Roster Bonus is doubled this week (1.0 pts/player instead of 0.5)." },
  7:  { name: "Position Power",   effect: "Choose a position — your top-scoring starter at that position gets a 1.5x boost this week." },
  8:  { name: "Fortress",         effect: "Your D/ST score is doubled this week." },
  9:  { name: "Recon",            effect: "Reveals your opponent's weekly token selection before the normal lock-and-reveal." },
  10: { name: "Air Raid",         effect: "+1 extra point per passing TD for your QB(s) this week." },
  11: { name: "Insurance",        effect: "If you lose this week, the loss doesn't count toward your record — logged as a no contest." },
  12: { name: "Last Stand",       effect: "If you trail by 20+ points after all players lock, all your bench points are retroactively added to your score." },
  13: { name: "Quick Feet",       effect: "You may make one late injury swap after games start this week." },
  14: { name: "Momentum",         effect: "If you're on a 2+ game win streak, +1.5 pts added to your score this week." },
  15: { name: "Underdog",         effect: "If you lose this week, +3 pts is added to your score as a consolation bonus (does not flip the result)." },
  16: { name: "Iron Will",        effect: "Your starter with the lowest pre-game projection this week gets 2x their actual points." },
  17: { name: "Clutch Gene",      effect: "If your matchup is within 5 pts, your score is rounded up by 1 full point." },
  18: { name: "Second Wind",      effect: "Reuse any one weekly token you've already used earlier this season." },
};
const POSITION_ORDER = ["QB", "RB", "WR", "TE", "K", "DEF", "DST"];

const POS_COLOR: Record<string, string> = {
  QB:  "#0057FF",
  RB:  "#3DDC84",
  WR:  "#FFD700",
  TE:  "#FF6B35",
  K:   "#f4f4f8",
  DEF: VILLAIN_COLOR,
  DST: VILLAIN_COLOR,
};

// Draft-mechanic slugs are excluded from roster badges (they fired during the draft)
const SLUG_TO_POWER_INFO: Record<string, { emoji: string; name: string }> = {
  gunslinger:           { emoji: "🎯", name: "Gunslinger" },
  berserker_rage:       { emoji: "🔥", name: "Berserker Rage" },
  reception_specialist: { emoji: "🙌", name: "Reception Specialist" },
  iron_defense:         { emoji: "🛡️", name: "Iron Defense" },
  red_zone_menace:      { emoji: "🚨", name: "Red Zone Menace" },
  goal_line_hammer:     { emoji: "🔨", name: "Goal Line Hammer" },
  seam_buster:          { emoji: "⚡", name: "Seam Buster" },
  sniper:               { emoji: "🔭", name: "Sniper" },
  power_negation:       { emoji: "❌", name: "Power Negation" },
  time_stone:           { emoji: "⏳", name: "Time Stone" },
  vampire_bite:         { emoji: "🦇", name: "Vampire Bite" },
};

const POWER_STATUS_STYLES: Record<string, { label: string; color: string; bg: string }> = {
  active:   { label: "Active",   color: "#3DDC84", bg: "rgba(61,220,132,0.15)" },
  fizzled:  { label: "Fizzled",  color: "#f4f4f8", bg: "#1c1c2b" },
  negated:  { label: "Negated",  color: VILLAIN_COLOR, bg: "rgba(204,0,0,0.15)" },
  restored: { label: "Restored", color: HERO_COLOR,    bg: "rgba(0,87,255,0.15)" },
  pending:  { label: "Pending",  color: "#f4f4f8", bg: "#1c1c2b" },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────
function positionRank(pos: string | null) {
  if (!pos) return POSITION_ORDER.length;
  const idx = POSITION_ORDER.indexOf(pos.toUpperCase());
  return idx === -1 ? POSITION_ORDER.length : idx;
}

function expandSlots(config: Record<string, number>): string[] {
  const order = ["QB", "RB", "WR", "TE", "FLEX", "K", "DEF"];
  const result: string[] = [];
  for (const pos of order) {
    const n = config[pos] ?? 0;
    if (n === 1) result.push(pos);
    else for (let i = 1; i <= n; i++) result.push(pos + "_" + i);
  }
  return result;
}

// ─── Sub-components ───────────────────────────────────────────────────────────
function FactionBadge({ faction }: { faction: "hero" | "villain" | null }) {
  if (faction === "hero")
    return <span className="rounded-full px-2 py-0.5 text-xs font-semibold uppercase tracking-wide" style={{ background: "rgba(0,87,255,0.15)", color: HERO_COLOR }}>Hero</span>;
  if (faction === "villain")
    return <span className="rounded-full px-2 py-0.5 text-xs font-semibold uppercase tracking-wide" style={{ background: "rgba(204,0,0,0.15)", color: VILLAIN_COLOR }}>Villain</span>;
  return <span className="rounded-full px-2 py-0.5 text-xs font-semibold uppercase tracking-wide" style={{ background: "#1c1c2b", color: "#f4f4f8" }}>&mdash;</span>;
}

function PosBadge({ position }: { position: string | null }) {
  const pos   = (position ?? "?").toUpperCase();
  const color = POS_COLOR[pos] ?? "#f4f4f8";
  return (
    <span className="inline-block w-8 rounded text-center text-xs font-bold leading-5 uppercase"
      style={{ background: color + "22", color }}>
      {pos}
    </span>
  );
}

function WeeklyTokenCard({
  tokenId,
  status,
  choice,
  leagueId,
  week,
  pastUsedTokenIds,
  locked,
  opponentTokenId,
}: {
  tokenId: number;
  status: string;
  choice: string | null;
  leagueId: string;
  week: number;
  pastUsedTokenIds: number[];
  locked: boolean;
  opponentTokenId?: number | null;
}) {
  const info = TOKEN_INFO[tokenId];
  if (!info) return null;
  const isUsed    = status === "used";
  const isExpired = status === "expired";
  const dimmed    = isUsed || isExpired;
  const needsChoice = !dimmed && (tokenId === 7 || tokenId === 18);
  return (
    <div
      className="flex flex-col gap-1 rounded-xl border p-4"
      style={{
        borderColor: dimmed ? "#2a2a40" : "#FFD700",
        background:  dimmed ? "#0f0f1a" : "rgba(255,215,0,0.05)",
        opacity:     dimmed ? 0.65 : 1,
      }}
    >
      <div className="flex items-center gap-2">
        <span className="text-base">⚡</span>
        <span className="text-sm font-bold uppercase tracking-wide" style={{ color: dimmed ? "#f4f4f8" : "#FFD700" }}>
          Weekly Power Token
        </span>
        <span
          className="ml-auto rounded-full px-2 py-0.5 text-xs font-semibold uppercase tracking-wide"
          style={{
            background: isUsed ? "rgba(61,220,132,0.15)" : isExpired ? "#1c1c2b" : "rgba(255,215,0,0.15)",
            color:      isUsed ? "#3DDC84"               : isExpired ? "#f4f4f8" : "#FFD700",
          }}
        >
          {isUsed ? "Used" : isExpired ? "Expired" : "Active"}
        </span>
      </div>
      <p className="text-lg font-bold" style={{ color: dimmed ? "#f4f4f8" : "#f4f4f8" }}>
        {info.name}
        {choice && tokenId === 7 && (
          <span className="ml-2 text-sm font-normal" style={{ color: "#f4f4f8" }}>
            (chosen pos: {choice})
          </span>
        )}
        {choice && tokenId === 18 && (
          <span className="ml-2 text-sm font-normal" style={{ color: "#f4f4f8" }}>
            (replaying: {TOKEN_INFO[parseInt(choice)]?.name ?? choice})
          </span>
        )}
      </p>
      <p className="text-sm" style={{ color: "#f4f4f8" }}>{info.effect}</p>
      {needsChoice && (
        <TokenChoicePicker
          leagueId={leagueId}
          week={week}
          tokenId={tokenId}
          currentChoice={choice}
          pastUsedTokenIds={pastUsedTokenIds}
          locked={locked}
        />
      )}
      {tokenId === 9 && !dimmed && (
        <div className="mt-2 rounded-lg border p-3" style={{ borderColor: "#2a2a40", background: "#0f0f1a" }}>
          <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: "#FFD700" }}>
            🔍 Opponent&apos;s Token Revealed
          </p>
          {opponentTokenId ? (
            <>
              <p className="mt-1 text-sm font-bold" style={{ color: "#f4f4f8" }}>
                {TOKEN_INFO[opponentTokenId]?.name ?? `Token #${opponentTokenId}`}
              </p>
              <p className="text-xs" style={{ color: "#f4f4f8" }}>
                {TOKEN_INFO[opponentTokenId]?.effect}
              </p>
            </>
          ) : (
            <p className="mt-1 text-xs" style={{ color: "#f4f4f8" }}>
              Opponent has no token assigned yet this week.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default async function RosterPage({
  params,
  searchParams,
}: {
  params:       Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; dropped?: string; ir?: string; lineup?: string; restored?: string; trade?: string }>;
}) {
  const { id: leagueId } = await params;
  const { error, dropped, ir, lineup: lineupSaved, restored, trade: tradeMsg } = await searchParams;
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: league } = await supabase
    .from("uff_leagues")
    .select("id, name, season, draft_rounds, ir_spots, lineup_slots, scoring_settings")
    .eq("id", leagueId)
    .maybeSingle();
  if (!league) redirect("/dashboard?error=" + encodeURIComponent("League not found."));

  const { data: me } = await supabase
    .from("league_members")
    .select("id, team_name, faction")
    .eq("league_id", leagueId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!me) redirect("/dashboard?error=" + encodeURIComponent("You're not a member of that league."));

  const week = getCurrentNFLWeek();

  const [
    { data: roster },
    { data: teams },
    { data: bonus },
    { data: powers },
    { data: lineupRows },
    { data: chips },
    { data: negatedPlayers },
    { data: gameScheduleRows },
    { data: weeklyToken },
    { data: pastTokenRows },
    { data: playerPowerRows },
    { data: qfToken },
  ] = await Promise.all([
    supabase
      .from("uff_roster_players")
      .select("id, added_at, player_id, slot, players(id, full_name, position, team, status)")
      .eq("member_id", me.id)
      .is("dropped_at", null)
      .order("added_at", { ascending: true })
      .returns<RosterRow[]>(),
    supabase.from("nfl_teams").select("abbr, faction").returns<TeamFactionRow[]>(),
    supabase.rpc("calculate_faction_roster_bonus", { p_member_id: me.id }),
    supabase
      .from("draft_power_assignments")
      .select("id, round, draft_powers(name, category, description), team_active_powers(status)")
      .eq("member_id", me.id)
      .order("round", { ascending: true })
      .returns<PowerRow[]>(),
    supabase.from("uff_lineups").select("slot, player_id").eq("member_id", me.id).eq("week", week),
    supabase
      .from("power_restore_chips")
      .select("id, earned_week, used")
      .eq("member_id", me.id)
      .eq("used", false)
      .order("earned_week", { ascending: true })
      .returns<ChipRow[]>(),
    supabase
      .from("player_draft_powers")
      .select("player_id, players(full_name), restored_at")
      .eq("league_id", leagueId)
      .eq("drafted_by_user_id", user.id)
      .eq("power", "power_negation")
      .is("restored_at", null)
      .returns<NegatedPlayerRow[]>(),
    supabase
      .from("uff_game_schedule")
      .select("team, kickoff_utc")
      .eq("season", 2026)
      .eq("week", week)
      .returns<GameScheduleRow[]>(),
    supabase
      .from("weekly_token_assignments")
      .select("token_id, status, choice")
      .eq("league_id", leagueId)
      .eq("member_id", me.id)
      .eq("week", week)
      .maybeSingle(),
    // Past used tokens — needed for Second Wind (token 18) choice picker
    // Must be from a prior week (week < current) so the current week's token can't replay itself
    supabase
      .from("weekly_token_assignments")
      .select("token_id")
      .eq("league_id", leagueId)
      .eq("member_id", me.id)
      .eq("status", "used")
      .lt("week", week),
    // Season powers tied to specific players (excludes draft mechanics)
    supabase
      .from("player_draft_powers")
      .select("player_id, power")
      .eq("league_id", leagueId)
      .eq("drafted_by_user_id", user.id)
      .returns<PlayerPowerRow[]>(),
    // Token 13 (Quick Feet) — allows one post-kickoff lineup swap
    supabase
      .from("weekly_token_assignments")
      .select("id")
      .eq("league_id", leagueId)
      .eq("member_id", me.id)
      .eq("week", week)
      .eq("token_id", 13)
      .eq("status", "pending")
      .maybeSingle(),
  ]);

  const quickFeetAvailable = !!qfToken;

  // ── Token 9 (Recon): reveal opponent's token ────────────────────────────────────────
  let opponentTokenId: number | null = null;
  if (weeklyToken?.token_id === 9 && weeklyToken.status === "pending") {
    const { data: myMatchup } = await supabase
      .from("uff_matchups")
      .select("matchup_id")
      .eq("league_id", leagueId)
      .eq("member_id", me.id)
      .eq("week", week)
      .maybeSingle();

    if (myMatchup) {
      const { data: oppMatchup } = await supabase
        .from("uff_matchups")
        .select("member_id")
        .eq("league_id", leagueId)
        .eq("matchup_id", myMatchup.matchup_id)
        .eq("week", week)
        .neq("member_id", me.id)
        .maybeSingle();

      if (oppMatchup) {
        const { data: oppToken } = await supabase
          .from("weekly_token_assignments")
          .select("token_id")
          .eq("league_id", leagueId)
          .eq("member_id", oppMatchup.member_id)
          .eq("week", week)
          .maybeSingle();
        opponentTokenId = oppToken?.token_id ?? null;
      }
    }
  }

  // ── Pending trades ────────────────────────────────────────────
  const { data: tradeRows } = await supabase
    .from("uff_trades")
    .select("id, proposer_id, receiver_id, proposer_player_ids, receiver_player_ids, status, created_at")
    .eq("league_id", leagueId)
    .eq("status", "pending")
    .or(`proposer_id.eq.${me.id},receiver_id.eq.${me.id}`)
    .returns<TradeRow[]>();

  const pendingTrades = tradeRows ?? [];
  let tradePlayerNames: Record<string, string> = {};
  let tradeMemberNames: Record<string, string> = {};

  if (pendingTrades.length > 0) {
    const allTradePlayerIds = [...new Set(pendingTrades.flatMap(t => [...t.proposer_player_ids, ...t.receiver_player_ids]))];
    const allTradeMemberIds = [...new Set(pendingTrades.flatMap(t => [t.proposer_id, t.receiver_id]).filter(id => id !== me.id))];
    const [{ data: tradePlayers }, { data: tradeMembers }] = await Promise.all([
      supabase.from("players").select("id, full_name").in("id", allTradePlayerIds).returns<{ id: string; full_name: string }[]>(),
      supabase.from("league_members").select("id, team_name").in("id", allTradeMemberIds).returns<{ id: string; team_name: string }[]>(),
    ]);
    for (const p of (tradePlayers ?? [])) tradePlayerNames[p.id] = p.full_name;
    for (const m of (tradeMembers ?? [])) tradeMemberNames[m.id] = m.team_name;
  }

  const incomingTrades = pendingTrades.filter(t => t.receiver_id === me.id);
  const outgoingTrades = pendingTrades.filter(t => t.proposer_id === me.id);

  // ── Live weekly pts (current week, from Sleeper) ──────────────────────────
  const FLAG_KEYS_SCORE = new Set([
    'pts_allow_0','pts_allow_1_6','pts_allow_7_13','pts_allow_14_20',
    'pts_allow_21_27','pts_allow_28_34','pts_allow_35p',
  ]);
  let seasonPts: Record<string, number> | undefined;
  const scoringSettings = (league as unknown as { scoring_settings: Record<string, number> }).scoring_settings ?? {};
  if (Object.keys(scoringSettings).length > 0) {
    try {
      const sleeperRes = await fetch(
        `https://api.sleeper.app/v1/stats/nfl/2026/${week}?season_type=regular`,
        { next: { revalidate: 300 } }
      );
      if (sleeperRes.ok) {
        const allStats: Record<string, Record<string, number>> = await sleeperRes.json();
        const ptsMap: Record<string, number> = {};
        let hasAnyPts = false;
        for (const r of (roster ?? [])) {
          const stats = allStats[r.player_id] ?? {};
          let score = 0;
          for (const [key, mult] of Object.entries(scoringSettings)) {
            const val = stats[key];
            if (val == null || val === 0) continue;
            score += FLAG_KEYS_SCORE.has(key) ? mult : val * (mult as number);
          }
          const rounded = Math.round(score * 100) / 100;
          ptsMap[r.player_id] = rounded;
          if (rounded > 0) hasAnyPts = true;
        }
        if (hasAnyPts) seasonPts = ptsMap;
      }
    } catch { /* pre-season or API down — no pts shown */ }
  }

  // Sort roster by position
  const teamFaction = new Map((teams ?? []).map((t) => [t.abbr, t.faction]));
  const allRoster = (roster ?? []).slice().sort((a, b) => {
    const diff = positionRank(a.players?.position ?? null) - positionRank(b.players?.position ?? null);
    return diff !== 0 ? diff : (a.players?.full_name ?? "").localeCompare(b.players?.full_name ?? "");
  });
  const activeRoster = allRoster.filter((r) => r.slot === "active");
  const irRoster     = allRoster.filter((r) => r.slot === "ir");

  const irSlotsUsed  = irRoster.length;
  const irSlotsTotal = league.ir_spots ?? 2;
  const bonusPoints  = typeof bonus === "number" ? bonus : Number(bonus ?? 0);

  const powerList      = powers ?? [];
  const chipList       = chips  ?? [];
  const negatedList    = negatedPlayers ?? [];
  const availableChips = chipList.length;
  const negatedPlayer  = negatedList[0] ?? null;
  const pastUsedTokenIds = [...new Set((pastTokenRows ?? []).map((r: { token_id: number }) => r.token_id))];

  // Build player_id → { emoji, name } map for inline badges on lineup cards
  const playerPowers: Record<string, { emoji: string; name: string }> = {};
  for (const row of (playerPowerRows ?? [])) {
    const info = SLUG_TO_POWER_INFO[row.power];
    if (info) playerPowers[row.player_id] = info;
  }

  const slotsConfig: Record<string, number> =
    (league.lineup_slots as Record<string, number>) ??
    { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DEF: 1 };
  const expandedSlots = expandSlots(slotsConfig);

  const currentLineup: Record<string, string> = {};
  for (const entry of (lineupRows ?? [])) currentLineup[entry.slot] = entry.player_id;

  const activeRosterForLineup = activeRoster
    .filter((r) => r.players?.position)
    .map((r) => ({
      player_id: r.player_id,
      full_name: r.players!.full_name,
      position:  r.players!.position!,
      team:      r.players!.team ?? undefined,
      status:    r.players!.status ?? undefined,
    }));

  // Build team -> kickoff map for per-player lock UI
  const gameTimes: Record<string, string> = {};
  for (const g of gameScheduleRows ?? []) gameTimes[g.team] = g.kickoff_utc;

  const factionAccent = me.faction === "hero" ? HERO_COLOR : me.faction === "villain" ? VILLAIN_COLOR : "#2a2a40";

  // ─── JSX ───────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen px-4 py-10 sm:px-8" style={{ background: "#0d0d1a", color: "#f4f4f8" }}>
      <main className="mx-auto flex max-w-7xl flex-col gap-6">

        {/* Back link */}
        <Link href={`/dashboard/league/${league.id}`} className="text-sm underline w-fit" style={{ color: HERO_COLOR }}>
          &larr; Back to {league.name}
        </Link>

        {/* Flash messages */}
        {error && (
          <p className="rounded-md border px-3 py-2 text-sm" style={{ borderColor: VILLAIN_COLOR, color: "#ff8a8a", background: "#1a0e16" }}>
            {decodeURIComponent(error)}
          </p>
        )}
        {dropped && <p className="rounded-md border px-3 py-2 text-sm" style={{ borderColor: "#3DDC84", color: "#3DDC84", background: "#0e1a12" }}>Player released to free agency.</p>}
        {ir      && <p className="rounded-md border px-3 py-2 text-sm" style={{ borderColor: HERO_COLOR, color: "#6fa3ff", background: "#0a0e1a" }}>Player moved to IR.</p>}
        {lineupSaved && <p className="rounded-md border px-3 py-2 text-sm" style={{ borderColor: "#3DDC84", color: "#3DDC84", background: "#0e1a12" }}>Lineup saved for Week {week}.</p>}
        {restored && <p className="rounded-md border px-3 py-2 text-sm" style={{ borderColor: HERO_COLOR, color: "#8ab4ff", background: "#0a0e1a" }}>Power Restore Chip used &mdash; scoring restored!</p>}
        {tradeMsg === "proposed"  && <p className="rounded-md border px-3 py-2 text-sm" style={{ borderColor: "#FFD700", color: "#FFD700", background: "#1a1a0e" }}>Trade offer sent!</p>}
        {tradeMsg === "accepted"  && <p className="rounded-md border px-3 py-2 text-sm" style={{ borderColor: "#3DDC84", color: "#3DDC84", background: "#0e1a12" }}>Trade accepted &mdash; rosters updated!</p>}
        {tradeMsg === "rejected"  && <p className="rounded-md border px-3 py-2 text-sm" style={{ borderColor: "#f4f4f8", color: "#f4f4f8", background: "#13131f" }}>Trade rejected.</p>}
        {tradeMsg === "cancelled" && <p className="rounded-md border px-3 py-2 text-sm" style={{ borderColor: "#f4f4f8", color: "#f4f4f8", background: "#13131f" }}>Trade offer cancelled.</p>}

        {/* ── Team header ── */}
        <div className="overflow-hidden rounded-xl border" style={{ borderColor: "#2a2a40" }}>
          <div style={{ height: 4, background: factionAccent }} />
          <div className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-col gap-1">
              <p className="text-xs font-semibold uppercase tracking-[0.25em]" style={{ color: "#f4f4f8" }}>My Team</p>
              <h1 className="text-3xl font-bold sm:text-4xl" style={{ fontFamily: "var(--font-display, sans-serif)", color: factionAccent }}>
                {me.team_name}
              </h1>
              <div className="flex flex-wrap items-center gap-2 text-sm" style={{ color: "#f4f4f8" }}>
                <FactionBadge faction={me.faction} />
                <span>&middot;</span>
                <span>Season {league.season}</span>
                <span>&middot;</span>
                <span>Faction Bonus: <strong style={{ color: factionAccent }}>+{bonusPoints.toFixed(1)} pts/wk</strong></span>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link href={`/dashboard/league/${leagueId}/free-agents`}
                className="rounded-md px-4 py-2 text-sm font-semibold"
                style={{ background: HERO_COLOR, color: "#f4f4f8" }}>
                + Add Player
              </Link>
              <a href="#ir-section"
                className="rounded-md px-4 py-2 text-sm font-semibold"
                style={{ background: "#1c1c2b", color: "#f4f4f8", border: "1px solid #2a2a40" }}>
                Manage IR
              </a>
              <Link href={`/dashboard/league/${leagueId}/trade`}
                className="rounded-md px-4 py-2 text-sm font-semibold transition-opacity hover:opacity-80"
                style={{ background: "#1c1c2b", color: "#f4f4f8", border: "1px solid #2a2a40" }}>
                Trade
              </Link>
            </div>
          </div>
        </div>

        {/* ── Weekly Power Token ── */}
        {weeklyToken && (
          <>
            <WeeklyTokenCard
              tokenId={weeklyToken.token_id}
              status={weeklyToken.status}
              choice={weeklyToken.choice}
              leagueId={leagueId}
              week={week}
              pastUsedTokenIds={pastUsedTokenIds}
              locked={isLineupLocked(week)}
              opponentTokenId={opponentTokenId}
            />
            {weeklyToken.status === "pending" && (
              <TokenAdvisor
                tokenName={TOKEN_INFO[weeklyToken.token_id]?.name ?? `Token #${weeklyToken.token_id}`}
                leagueId={leagueId}
                week={week}
              />
            )}
          </>
        )}

        {/* ── Drag-and-Drop Lineup ── */}
        {activeRosterForLineup.length > 0 && (
          <DragDropLineup
            leagueId={leagueId}
            week={week}
            slots={expandedSlots}
            activeRoster={activeRosterForLineup}
            currentLineup={currentLineup}
            locked={isLineupLocked(week)}
            lockTime={getWeekLockTime(week).toISOString()}
            gameTimes={Object.keys(gameTimes).length > 0 ? gameTimes : undefined}
            seasonPts={seasonPts}
            playerPowers={Object.keys(playerPowers).length > 0 ? playerPowers : undefined}
            irSlotsAvailable={irSlotsTotal - irSlotsUsed}
            quickFeetAvailable={quickFeetAvailable}
          />
        )}

        {/* ── Trade Inbox ── */}
        {(incomingTrades.length > 0 || outgoingTrades.length > 0) && (
          <section className="flex flex-col gap-3">
            <h2 className="text-lg font-semibold" style={{ color: "#FFD700" }}>Trade Inbox</h2>

            {incomingTrades.length > 0 && (
              <div className="flex flex-col gap-3">
                <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "#f4f4f8" }}>Incoming offers</p>
                {incomingTrades.map((t) => (
                  <div key={t.id} className="rounded-xl border p-4" style={{ borderColor: "#2a2a40", background: "#13132b" }}>
                    <p className="text-sm font-bold mb-2" style={{ color: "#f4f4f8" }}>
                      {tradeMemberNames[t.proposer_id] ?? "A team"} wants to trade
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3 text-sm">
                      <div>
                        <p className="text-xs font-semibold uppercase mb-1" style={{ color: "#f4f4f8" }}>They send</p>
                        <ul className="flex flex-col gap-0.5">
                          {t.proposer_player_ids.map(pid => (
                            <li key={pid} style={{ color: "#3DDC84" }}>{tradePlayerNames[pid] ?? pid}</li>
                          ))}
                        </ul>
                      </div>
                      <div>
                        <p className="text-xs font-semibold uppercase mb-1" style={{ color: "#f4f4f8" }}>You send</p>
                        <ul className="flex flex-col gap-0.5">
                          {t.receiver_player_ids.map(pid => (
                            <li key={pid} style={{ color: "#FF6B35" }}>{tradePlayerNames[pid] ?? pid}</li>
                          ))}
                        </ul>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <form action={respondToTrade}>
                        <input type="hidden" name="leagueId" value={leagueId} />
                        <input type="hidden" name="tradeId" value={t.id} />
                        <input type="hidden" name="accept" value="true" />
                        <button type="submit" className="rounded-md px-4 py-1.5 text-xs font-bold transition-opacity hover:opacity-90"
                          style={{ background: "#3DDC84", color: "#0d0d1a" }}>Accept</button>
                      </form>
                      <form action={respondToTrade}>
                        <input type="hidden" name="leagueId" value={leagueId} />
                        <input type="hidden" name="tradeId" value={t.id} />
                        <input type="hidden" name="accept" value="false" />
                        <button type="submit" className="rounded-md px-4 py-1.5 text-xs font-bold transition-opacity hover:opacity-90"
                          style={{ background: "#1c1c2b", color: "#f4f4f8", border: "1px solid #2a2a40" }}>Reject</button>
                      </form>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {outgoingTrades.length > 0 && (
              <div className="flex flex-col gap-3">
                <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "#f4f4f8" }}>Pending offers you sent</p>
                {outgoingTrades.map((t) => (
                  <div key={t.id} className="rounded-xl border p-4" style={{ borderColor: "#2a2a40", background: "#13132b" }}>
                    <p className="text-sm font-bold mb-2" style={{ color: "#f4f4f8" }}>
                      Offer to {tradeMemberNames[t.receiver_id] ?? "a team"}
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3 text-sm">
                      <div>
                        <p className="text-xs font-semibold uppercase mb-1" style={{ color: "#f4f4f8" }}>You send</p>
                        <ul className="flex flex-col gap-0.5">
                          {t.proposer_player_ids.map(pid => (
                            <li key={pid} style={{ color: "#FF6B35" }}>{tradePlayerNames[pid] ?? pid}</li>
                          ))}
                        </ul>
                      </div>
                      <div>
                        <p className="text-xs font-semibold uppercase mb-1" style={{ color: "#f4f4f8" }}>You receive</p>
                        <ul className="flex flex-col gap-0.5">
                          {t.receiver_player_ids.map(pid => (
                            <li key={pid} style={{ color: "#3DDC84" }}>{tradePlayerNames[pid] ?? pid}</li>
                          ))}
                        </ul>
                      </div>
                    </div>
                    <form action={cancelTrade}>
                      <input type="hidden" name="leagueId" value={leagueId} />
                      <input type="hidden" name="tradeId" value={t.id} />
                      <button type="submit" className="rounded-md px-4 py-1.5 text-xs font-bold transition-opacity hover:opacity-90"
                        style={{ background: "#1c1c2b", color: "#CC0000", border: "1px solid rgba(204,0,0,0.3)" }}>
                        Cancel Offer
                      </button>
                    </form>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {/* ── IR Section ── */}
        <section id="ir-section" className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold" style={{ color: VILLAIN_COLOR }}>
            Injured Reserve ({irSlotsUsed} / {irSlotsTotal})
          </h2>
          <p className="text-xs" style={{ color: "#f4f4f8" }}>
            IR players do not score or count toward your active roster cap.
            Must have an official Injured Reserve designation.
          </p>
          {irRoster.length === 0 ? (
            <p className="rounded-lg border p-4 text-sm" style={{ borderColor: "#2a2a40", color: "#f4f4f8" }}>No players on IR.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {irRoster.map((r) => {
                const player = r.players;
                return (
                  <div key={r.id} className="flex items-center gap-3 rounded-lg border px-4 py-3"
                    style={{ borderColor: "rgba(204,0,0,0.4)", background: "rgba(204,0,0,0.04)" }}>
                    <PosBadge position={player?.position ?? null} />
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold truncate">{player?.full_name ?? r.player_id}</p>
                      <p className="text-sm" style={{ color: VILLAIN_COLOR }}>
                        {player?.team ?? "FA"} &middot; Injured Reserve
                      </p>
                    </div>
                    <form action={moveFromIR}>
                      <input type="hidden" name="leagueId" value={leagueId} />
                      <input type="hidden" name="playerId" value={r.player_id} />
                      <button type="submit" className="rounded px-2 py-1 text-xs font-semibold"
                        style={{ background: "rgba(0,87,255,0.2)", color: "#6fa3ff" }}>Activate</button>
                    </form>
                    <DropButton
                      leagueId={leagueId}
                      playerId={r.player_id}
                      playerName={player?.full_name ?? r.player_id}
                    />
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* ── Your Powers ── */}
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold" style={{ color: "#FFD700" }}>Your Powers</h2>

          {/* Restore chip action */}
          {availableChips > 0 && (
            <div className="rounded-lg border px-3 py-2" style={{ borderColor: HERO_COLOR, background: "rgba(0,87,255,0.07)" }}>
              <p className="text-xs uppercase tracking-wide" style={{ color: HERO_COLOR }}>
                Power Restore Chips — {availableChips} available
              </p>
              {negatedPlayer ? (
                <form action={useRestoreChip} className="mt-2">
                  <input type="hidden" name="leagueId" value={leagueId} />
                  <input type="hidden" name="chipId"   value={chipList[0].id} />
                  <input type="hidden" name="playerId" value={negatedPlayer.player_id} />
                  <button type="submit" className="w-full rounded-md px-3 py-1.5 text-xs font-semibold"
                    style={{ background: HERO_COLOR, color: "#f4f4f8" }}>
                    Restore {negatedPlayer.players?.full_name?.split(" ").pop() ?? "player"}
                  </button>
                </form>
              ) : (
                <p className="mt-1 text-xs" style={{ color: "#f4f4f8" }}>No negated players — bank it or trade it.</p>
              )}
            </div>
          )}

          {/* Compact power chips — season-effect and tied-to-pick only */}
          {powerList.filter((p) => p.draft_powers?.category !== "Draft Mechanic").length === 0 ? (
            <p className="rounded-lg border p-4 text-sm" style={{ borderColor: "#2a2a40", color: "#f4f4f8" }}>
              Powers are assigned during the draft — none yet.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {powerList
                .filter((p) => p.draft_powers?.category !== "Draft Mechanic")
                .map((p) => {
                  const status  = p.team_active_powers?.[0]?.status ?? "pending";
                  const name    = p.draft_powers?.name ?? "Unknown";
                  const slugKey = Object.entries(SLUG_TO_POWER_INFO).find(([, v]) => v.name === name)?.[0];
                  const emoji   = slugKey ? SLUG_TO_POWER_INFO[slugKey].emoji : "⚡";
                  const s = POWER_STATUS_STYLES[status] ?? POWER_STATUS_STYLES.pending;
                  return (
                    <div
                      key={p.id}
                      title={`Round ${p.round} · ${status}`}
                      className="flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold"
                      style={{ borderColor: s.color + "55", background: s.bg, color: s.color }}
                    >
                      <span>{emoji}</span>
                      <span>{name}</span>
                    </div>
                  );
                })}
            </div>
          )}
        </section>

      </main>
    </div>
  );
}
