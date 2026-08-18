import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import TransactionFeed, { Transaction, PlayerInfo } from "./TransactionFeed";

interface DraftPickRow {
  id: string;
  round: number;
  pick_no: number;
  member_id: string;
  player_id: string;
  picked_at: string;
  players: { full_name: string; position: string | null; team: string | null } | null;
  league_members: { team_name: string; faction: "hero" | "villain" | null } | null;
}

interface RosterRow {
  id: string;
  member_id: string;
  player_id: string;
  added_at: string;
  dropped_at: string | null;
  slot: string;
  players: { full_name: string; position: string | null; team: string | null } | null;
  league_members: { team_name: string; faction: "hero" | "villain" | null } | null;
}

interface TradeRow {
  id: string;
  proposer_id: string;
  receiver_id: string;
  proposer_player_ids: string[];
  receiver_player_ids: string[];
  updated_at: string;
  proposer: { team_name: string; faction: "hero" | "villain" | null } | null;
  receiver: { team_name: string; faction: "hero" | "villain" | null } | null;
}

export default async function TransactionsPage({
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
    .select("id, name")
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

  // Fetch all 3 data sources in parallel
  const [draftRes, rosterRes, tradeRes] = await Promise.all([
    supabase
      .from("uff_draft_picks")
      .select("id, round, pick_no, member_id, player_id, picked_at, players(full_name, position, team), league_members(team_name, faction)")
      .eq("league_id", leagueId)
      .order("picked_at", { ascending: false })
      .returns<DraftPickRow[]>(),

    supabase
      .from("uff_roster_players")
      .select("id, member_id, player_id, added_at, dropped_at, slot, players(full_name, position, team), league_members(team_name, faction)")
      .eq("league_id", leagueId)
      .returns<RosterRow[]>(),

    supabase
      .from("uff_trades")
      .select("id, proposer_id, receiver_id, proposer_player_ids, receiver_player_ids, updated_at, proposer:league_members!proposer_id(team_name, faction), receiver:league_members!receiver_id(team_name, faction)")
      .eq("league_id", leagueId)
      .eq("status", "accepted")
      .order("updated_at", { ascending: false })
      .returns<TradeRow[]>(),
  ]);

  const draftPicks = draftRes.data ?? [];
  const rosterRows = rosterRes.data ?? [];
  const trades     = tradeRes.data ?? [];

  // Build a set of (member_id|player_id) combos that came from the draft
  // so we can label them correctly and exclude from "add" events
  const draftedKeys = new Set(draftPicks.map((d) => `${d.member_id}|${d.player_id}`));

  // ── Collect all player IDs needed for trade lookups ──────────────────────
  const tradePlayerIds = new Set<string>();
  for (const t of trades) {
    t.proposer_player_ids.forEach((id) => tradePlayerIds.add(id));
    t.receiver_player_ids.forEach((id) => tradePlayerIds.add(id));
  }

  let playerLookup: Record<string, { full_name: string; position: string | null; team: string | null }> = {};
  if (tradePlayerIds.size > 0) {
    const { data: tradePlayers } = await supabase
      .from("players")
      .select("id, full_name, position, team")
      .in("id", [...tradePlayerIds]);
    for (const p of tradePlayers ?? []) {
      playerLookup[p.id] = { full_name: p.full_name, position: p.position, team: p.team };
    }
  }

  // ── Build unified Transaction array ──────────────────────────────────────
  const transactions: Transaction[] = [];

  // Draft picks
  for (const d of draftPicks) {
    transactions.push({
      type: "draft",
      id: d.id,
      timestamp: new Date(d.picked_at),
      teamName: d.league_members?.team_name ?? "Unknown",
      faction: d.league_members?.faction ?? null,
      player: {
        playerId: d.player_id,
        playerName: d.players?.full_name ?? d.player_id,
        position: d.players?.position ?? null,
        team: d.players?.team ?? null,
      },
      round: d.round,
      pickNo: d.pick_no,
    });
  }

  // Roster rows created by an executed trade are reported by the trade event
  // itself — showing them as waiver "adds" double-reported every trade.
  const tradedKeys = new Set<string>();
  for (const t of trades) {
    for (const pid of t.proposer_player_ids) tradedKeys.add(`${t.receiver_id}|${pid}`);
    for (const pid of t.receiver_player_ids) tradedKeys.add(`${t.proposer_id}|${pid}`);
  }

  // Waiver adds + drops (exclude draft picks and trade acquisitions)
  for (const r of rosterRows) {
    const isDrafted = draftedKeys.has(`${r.member_id}|${r.player_id}`);
    const isTraded  = tradedKeys.has(`${r.member_id}|${r.player_id}`);
    const player: PlayerInfo = {
      playerId: r.player_id,
      playerName: r.players?.full_name ?? r.player_id,
      position: r.players?.position ?? null,
      team: r.players?.team ?? null,
    };
    const teamName = r.league_members?.team_name ?? "Unknown";
    const faction = r.league_members?.faction ?? null;

    // Add event — only for genuine waiver pickups
    if (!isDrafted && !isTraded) {
      transactions.push({
        type: "add",
        id: r.id + "-add",
        timestamp: new Date(r.added_at),
        teamName,
        faction,
        player,
      });
    }

    // Drop event — always show drops (whether they drafted or added from waivers)
    if (r.dropped_at) {
      transactions.push({
        type: "drop",
        id: r.id + "-drop",
        timestamp: new Date(r.dropped_at),
        teamName,
        faction,
        player,
      });
    }
  }

  // Completed trades
  for (const t of trades) {
    const toPlayerInfo = (ids: string[]): PlayerInfo[] =>
      ids.map((id) => ({
        playerId: id,
        playerName: playerLookup[id]?.full_name ?? id,
        position: playerLookup[id]?.position ?? null,
        team: playerLookup[id]?.team ?? null,
      }));

    transactions.push({
      type: "trade",
      id: t.id,
      timestamp: new Date(t.updated_at),
      proposerName: t.proposer?.team_name ?? "Unknown",
      proposerFaction: t.proposer?.faction ?? null,
      receiverName: t.receiver?.team_name ?? "Unknown",
      receiverFaction: t.receiver?.faction ?? null,
      proposerSent: toPlayerInfo(t.proposer_player_ids),
      receiverSent: toPlayerInfo(t.receiver_player_ids),
    });
  }

  // Sort newest first
  transactions.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

  return (
    <div className="min-h-screen px-6 py-12 sm:px-12" style={{ background: "#0d0d1a", color: "#f4f4f8" }}>
      <main className="mx-auto flex max-w-3xl flex-col gap-8">
        <header className="flex flex-col gap-2">
          <Link
            href={`/dashboard/league/${leagueId}`}
            className="text-sm underline"
            style={{ color: "#0057FF" }}
          >
            &larr; Back to {league.name}
          </Link>
          <p className="text-sm uppercase tracking-[0.3em]" style={{ color: "#FFD700" }}>
            Ultimate Fantasy Football
          </p>
          <h1
            className="text-3xl sm:text-4xl"
            style={{ fontFamily: "var(--font-display, sans-serif)", color: "#f4f4f8" }}
          >
            Transactions
          </h1>
          <p className="text-sm text-white">
            All league activity — draft picks, adds, drops, and completed trades
          </p>
        </header>

        <TransactionFeed transactions={transactions} />
      </main>
    </div>
  );
}
