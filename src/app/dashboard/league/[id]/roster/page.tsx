import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { dropPlayer, moveToIR, moveFromIR, useRestoreChip } from "../player-actions";
import LineupManager from "./LineupManager";

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

interface TeamFactionRow {
  abbr: string;
  faction: "hero" | "villain";
}

interface PowerRow {
  id: string;
  round: number;
  draft_powers: { name: string; category: string | null; description: string } | null;
  team_active_powers: { status: string }[] | null;
}

interface DraftPickRow {
  id: string;
  round: number;
  pick_no: number;
  picked_at: string;
  players: { full_name: string; position: string | null; team: string | null } | null;
  league_members: { team_name: string } | null;
}

interface ChipRow {
  id: string;
  earned_week: number;
  used: boolean;
}

interface NegatedPlayerRow {
  player_id: string;
  players: { full_name: string } | null;
  restored_at: string | null;
}

interface NewsItem {
  title: string;
  link: string;
}

const HERO_COLOR = "#0057FF";
const VILLAIN_COLOR = "#CC0000";
const POSITION_ORDER = ["QB", "RB", "WR", "TE", "K", "DEF", "DST"];

const POWER_STATUS_STYLES: Record<string, { label: string; color: string; bg: string }> = {
  active:   { label: "Active",   color: "#3DDC84", bg: "rgba(61,220,132,0.15)" },
  fizzled:  { label: "Fizzled",  color: "#8a8a9a", bg: "#1c1c2b" },
  negated:  { label: "Negated",  color: "#CC0000", bg: "rgba(204,0,0,0.15)" },
  restored: { label: "Restored", color: "#0057FF", bg: "rgba(0,87,255,0.15)" },
  pending:  { label: "Pending",  color: "#8a8a9a", bg: "#1c1c2b" },
};

function positionRank(position: string | null) {
  if (!position) return POSITION_ORDER.length;
  const idx = POSITION_ORDER.indexOf(position.toUpperCase());
  return idx === -1 ? POSITION_ORDER.length : idx;
}

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

async function getNflNews(): Promise<NewsItem[]> {
  try {
    const res = await fetch("https://www.espn.com/espn/rss/nfl/news", {
      next: { revalidate: 1800 },
    });
    if (!res.ok) return [];
    const xml = await res.text();
    const items: NewsItem[] = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let match: RegExpExecArray | null;
    while ((match = itemRegex.exec(xml)) && items.length < 5) {
      const block = match[1];
      const title = block.match(/<title>([\s\S]*?)<\/title>/)?.[1]?.replace(/<!\[CDATA\[|\]\]>/g, "").trim();
      const link  = block.match(/<link>([\s\S]*?)<\/link>/)?.[1]?.replace(/<!\[CDATA\[|\]\]>/g, "").trim();
      if (title && link) items.push({ title, link });
    }
    return items;
  } catch { return []; }
}

function getCurrentNFLWeek(): number {
  const seasonStart = new Date("2026-09-03");
  const now = new Date();
  const diff = Math.floor((now.getTime() - seasonStart.getTime()) / (7 * 24 * 60 * 60 * 1000));
  return Math.min(Math.max(diff + 1, 1), 18);
}

function expandSlots(config: Record<string, number>): string[] {
  const order = ["QB", "RB", "WR", "TE", "FLEX", "K", "DEF"];
  const result: string[] = [];
  for (const pos of order) {
    const count = config[pos] ?? 0;
    if (count === 1) result.push(pos);
    else for (let i = 1; i <= count; i++) result.push(`${pos}_${i}`);
  }
  return result;
}

function FactionBadge({ faction }: { faction: "hero" | "villain" | null }) {
  if (faction === "hero") return (
    <span className="rounded-full px-2 py-0.5 text-xs font-semibold uppercase tracking-wide"
      style={{ background: "rgba(0,87,255,0.15)", color: HERO_COLOR }}>Hero</span>
  );
  if (faction === "villain") return (
    <span className="rounded-full px-2 py-0.5 text-xs font-semibold uppercase tracking-wide"
      style={{ background: "rgba(204,0,0,0.15)", color: VILLAIN_COLOR }}>Villain</span>
  );
  return <span className="rounded-full px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-zinc-500"
    style={{ background: "#1c1c2b" }}>&mdash;</span>;
}

function PowerStatusBadge({ status }: { status: string }) {
  const style = POWER_STATUS_STYLES[status] ?? POWER_STATUS_STYLES.pending;
  return (
    <span className="rounded-full px-2 py-0.5 text-xs font-semibold uppercase tracking-wide"
      style={{ background: style.bg, color: style.color }}>{style.label}</span>
  );
}

export default async function RosterPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; dropped?: string; ir?: string; lineup?: string; restored?: string }>;
}) {
  const { id: leagueId } = await params;
  const { error, dropped, ir, lineup: lineupSaved, restored } = await searchParams;
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: league } = await supabase
    .from("uff_leagues")
    .select("id, name, season, draft_rounds, ir_spots, lineup_slots")
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
    { data: bonus, error: bonusError },
    { data: powers },
    { data: picks },
    { data: lineupRows },
    { data: chips },
    { data: negatedPlayers },
    news,
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
    supabase
      .from("uff_draft_picks")
      .select("id, round, pick_no, picked_at, players(full_name, position, team), league_members(team_name)")
      .eq("league_id", leagueId)
      .order("picked_at", { ascending: false })
      .limit(8)
      .returns<DraftPickRow[]>(),
    supabase
      .from("uff_lineups")
      .select("slot, player_id")
      .eq("member_id", me.id)
      .eq("week", week),
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
    getNflNews(),
  ]);

  const teamFaction = new Map((teams ?? []).map((t) => [t.abbr, t.faction]));
  const allRoster = (roster ?? []).slice().sort((a, b) => {
    const pa = positionRank(a.players?.position ?? null);
    const pb = positionRank(b.players?.position ?? null);
    if (pa !== pb) return pa - pb;
    return (a.players?.full_name ?? "").localeCompare(b.players?.full_name ?? "");
  });

  const activeRoster = allRoster.filter((r) => r.slot === "active");
  const irRoster    = allRoster.filter((r) => r.slot === "ir");
  const irSlotsUsed = irRoster.length;
  const irSlotsTotal = league.ir_spots ?? 2;

  if (bonusError) console.error("[roster] faction bonus error:", bonusError.message);
  const bonusPoints = typeof bonus === "number" ? bonus : Number(bonus ?? 0);
  const matchingCount = activeRoster.filter((r) => {
    const f = r.players?.team ? teamFaction.get(r.players.team) : null;
    return me.faction && f === me.faction;
  }).length;

  const powerList       = powers ?? [];
  const pickList        = picks  ?? [];
  const chipList        = chips  ?? [];
  const negatedList     = negatedPlayers ?? [];
  const availableChips  = chipList.length;
  const negatedPlayer   = negatedList[0] ?? null; // only one Power Negation per manager

  // Lineup management data
  const slotsConfig: Record<string, number> = (league.lineup_slots as Record<string, number>) ??
    { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DEF: 1 };
  const expandedSlots = expandSlots(slotsConfig);

  const currentLineup: Record<string, string> = {};
  for (const entry of (lineupRows ?? [])) {
    currentLineup[entry.slot] = entry.player_id;
  }

  const activeRosterForLineup = activeRoster
    .filter((r) => r.players?.position)
    .map((r) => ({
      player_id: r.player_id,
      full_name: r.players!.full_name,
      position: r.players!.position!,
    }));

  return (
    <div className="min-h-screen px-6 py-12 sm:px-12" style={{ background: "#0d0d1a", color: "#f4f4f8" }}>
      <main className="mx-auto flex max-w-6xl flex-col gap-8">

        <header className="flex flex-col gap-2">
          <Link href={`/dashboard/league/${league.id}`} className="text-sm underline" style={{ color: "#0057FF" }}>
            &larr; Back to {league.name}
          </Link>
          <p className="text-sm uppercase tracking-[0.3em]" style={{ color: "#FFD700" }}>My Team</p>
          <h1 className="text-3xl sm:text-4xl" style={{ fontFamily: "var(--font-display, sans-serif)", color: "#0057FF" }}>
            {me.team_name}
          </h1>
          <div className="flex items-center gap-2 text-sm text-zinc-400">
            <span>Season {league.season}</span>
            <span>&middot;</span>
            <span>Faction:</span>
            <FactionBadge faction={me.faction} />
            <span>&middot;</span>
            <Link href={`/dashboard/league/${leagueId}/free-agents`}
              className="font-semibold underline" style={{ color: "#FFD700" }}>
              Free Agents &rarr;
            </Link>
          </div>
        </header>

        {error && (
          <p className="rounded-md border px-3 py-2 text-sm" style={{ borderColor: "#CC0000", color: "#ff8a8a", background: "#1a0e16" }}>
            {decodeURIComponent(error)}
          </p>
        )}
        {dropped && (
          <p className="rounded-md border px-3 py-2 text-sm" style={{ borderColor: "#3DDC84", color: "#3DDC84", background: "#0e1a12" }}>
            Player released to free agency.
          </p>
        )}
        {ir && (
          <p className="rounded-md border px-3 py-2 text-sm" style={{ borderColor: "#0057FF", color: "#6fa3ff", background: "#0a0e1a" }}>
            Player moved to IR.
          </p>
        )}
        {lineupSaved && (
          <p className="rounded-md border px-3 py-2 text-sm" style={{ borderColor: "#3DDC84", color: "#3DDC84", background: "#0e1a12" }}>
            Lineup saved for Week {week}.
          </p>
        )}
        {restored && (
          <p className="rounded-md border px-3 py-2 text-sm" style={{ borderColor: "#0057FF", color: "#8ab4ff", background: "#0a0e1a" }}>
            ✅ Power Restore Chip used — your player's scoring is back to normal!
          </p>
        )}

        {/* Lineup Manager */}
        {activeRosterForLineup.length > 0 && (
          <LineupManager
            leagueId={leagueId}
            week={week}
            slots={expandedSlots}
            activeRoster={activeRosterForLineup}
            currentLineup={currentLineup}
          />
        )}

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[260px_minmax(0,1fr)_300px]">

          {/* Left: powers + chips */}
          <aside className="order-2 flex flex-col gap-3 lg:order-1">
            <h2 className="text-lg font-semibold" style={{ color: "#FFD700" }}>Your Powers</h2>

            {/* Restore Chips indicator */}
            {availableChips > 0 && (
              <div className="rounded-lg border px-3 py-2" style={{ borderColor: "#0057FF", background: "rgba(0,87,255,0.07)" }}>
                <p className="text-xs uppercase tracking-wide" style={{ color: "#0057FF" }}>Power Restore Chips</p>
                <p className="mt-0.5 text-sm font-semibold" style={{ color: "#f4f4f8" }}>
                  {availableChips} chip{availableChips !== 1 ? "s" : ""} available
                </p>
                {negatedPlayer && (
                  <form action={useRestoreChip} className="mt-2">
                    <input type="hidden" name="leagueId" value={leagueId} />
                    <input type="hidden" name="chipId" value={chipList[0].id} />
                    <input type="hidden" name="playerId" value={negatedPlayer.player_id} />
                    <button
                      type="submit"
                      className="w-full rounded-md px-3 py-1.5 text-xs font-semibold"
                      style={{ background: "#0057FF", color: "#f4f4f8" }}
                    >
                      Restore {negatedPlayer.players?.full_name?.split(" ").pop() ?? "player"}
                    </button>
                  </form>
                )}
                {!negatedPlayer && (
                  <p className="mt-1 text-xs text-zinc-500">
                    No negated players — bank it or trade it.
                  </p>
                )}
              </div>
            )}

            {powerList.length === 0 ? (
              <p className="rounded-lg border p-4 text-sm text-zinc-400" style={{ borderColor: "#2a2a40" }}>
                Powers are assigned during the draft &mdash; none yet.
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                {powerList.map((p) => {
                  const status = p.team_active_powers?.[0]?.status ?? "pending";
                  const isNegated = status === "negated";
                  return (
                    <div key={p.id} className="rounded-lg border p-3" style={{ borderColor: isNegated ? "rgba(204,0,0,0.4)" : "#2a2a40" }}>
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs uppercase tracking-wide text-zinc-500">Round {p.round}</p>
                        <PowerStatusBadge status={status} />
                      </div>
                      <p className="mt-1 text-sm font-semibold">{p.draft_powers?.name ?? "Unknown power"}</p>
                      {isNegated && negatedPlayer && (
                        <p className="mt-1 text-xs" style={{ color: "#CC0000" }}>
                          {negatedPlayer.players?.full_name ?? "Your pick"} scoring halved this season.
                          {availableChips > 0 ? " Use a chip above to restore." : " Earn a chip to restore."}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </aside>

          {/* Center: roster + IR + faction bonus */}
          <div className="order-1 flex flex-col gap-8 lg:order-2">

            {/* Faction Roster Bonus */}
            <section className="flex flex-col gap-2 rounded-lg border p-5" style={{ borderColor: "#2a2a40" }}>
              <h2 className="text-lg font-semibold" style={{ color: "#FFD700" }}>Faction Roster Bonus</h2>
              {me.faction ? (
                <>
                  <p className="text-sm text-zinc-400">
                    +0.5 pts per active player on a {me.faction === "hero" ? "Hero (AFC)" : "Villain (NFC)"} team.
                    IR players do not count.
                  </p>
                  <p className="text-2xl font-semibold"
                    style={{ color: me.faction === "hero" ? HERO_COLOR : VILLAIN_COLOR }}>
                    +{bonusPoints.toFixed(1)} pts/week
                  </p>
                  <p className="text-sm text-zinc-500">
                    {matchingCount} of {activeRoster.length} active player{activeRoster.length === 1 ? "" : "s"} match your faction.
                  </p>
                </>
              ) : (
                <p className="text-sm text-zinc-400">
                  Pick a faction on the{" "}
                  <Link href={`/dashboard/league/${league.id}`} className="underline" style={{ color: "#0057FF" }}>
                    league page
                  </Link>{" "}
                  to start earning the Faction Roster Bonus.
                </p>
              )}
            </section>

            {/* Active Roster */}
            <section className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold" style={{ color: "#FFD700" }}>
                  Active Roster ({activeRoster.length} / {league.draft_rounds})
                </h2>
                <Link href={`/dashboard/league/${leagueId}/free-agents`}
                  className="text-xs font-semibold underline" style={{ color: "#0057FF" }}>
                  + Add player
                </Link>
              </div>

              {activeRoster.length === 0 && (
                <p className="rounded-lg border p-5 text-sm text-zinc-400" style={{ borderColor: "#2a2a40" }}>
                  No active players &mdash; draft players or add from free agency.
                </p>
              )}

              <div className="flex flex-col gap-2">
                {activeRoster.map((r) => {
                  const player   = r.players;
                  const pFaction = player?.team ? teamFaction.get(player.team) ?? null : null;
                  const matches  = me.faction !== null && pFaction === me.faction;
                  const isIR     = player?.status === "Injured Reserve";
                  const isStarting = Object.values(currentLineup).includes(r.player_id);
                  return (
                    <div key={r.id} className="flex items-center gap-3 rounded-lg border px-4 py-3"
                      style={{ borderColor: matches ? (me.faction === "hero" ? HERO_COLOR : VILLAIN_COLOR) : "#2a2a40" }}>

                      {/* Starter indicator */}
                      <span
                        className="w-4 shrink-0 text-center text-xs font-bold"
                        style={{ color: isStarting ? "#3DDC84" : "#2a2a40" }}
                        title={isStarting ? "Starting" : "Bench"}
                      >
                        {isStarting ? "S" : "B"}
                      </span>

                      <div className="flex-1 min-w-0">
                        <p className="font-semibold truncate">{player?.full_name ?? r.player_id}</p>
                        <p className="text-sm text-zinc-400">
                          {player?.position ?? "?"} &middot; {player?.team ?? "FA"}
                          {player?.status && player.status !== "Active" && (
                            <span className="ml-1 font-semibold" style={{ color: isIR ? "#CC0000" : "#FFD700" }}>
                              &middot; {player.status}
                            </span>
                          )}
                        </p>
                      </div>

                      <FactionBadge faction={pFaction} />

                      {isIR && irSlotsUsed < irSlotsTotal && (
                        <form action={moveToIR}>
                          <input type="hidden" name="leagueId" value={leagueId} />
                          <input type="hidden" name="playerId" value={r.player_id} />
                          <button type="submit"
                            className="rounded px-2 py-1 text-xs font-semibold"
                            style={{ background: "rgba(204,0,0,0.2)", color: "#ff8a8a" }}>
                            IR
                          </button>
                        </form>
                      )}

                      <form action={dropPlayer}>
                        <input type="hidden" name="leagueId" value={leagueId} />
                        <input type="hidden" name="playerId" value={r.player_id} />
                        <input type="hidden" name="returnTo" value="roster" />
                        <button type="submit"
                          className="rounded px-2 py-1 text-xs font-semibold"
                          style={{ background: "#1c1c2b", color: "#8a8a9a" }}>
                          Drop
                        </button>
                      </form>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* IR Roster */}
            <section className="flex flex-col gap-3">
              <h2 className="text-lg font-semibold" style={{ color: "#CC0000" }}>
                Injured Reserve ({irSlotsUsed} / {irSlotsTotal})
              </h2>
              <p className="text-xs text-zinc-500">
                IR players do not score or count toward your active roster cap.
                Must have an official Injured Reserve designation to be placed here.
              </p>

              {irRoster.length === 0 && (
                <p className="rounded-lg border p-4 text-sm text-zinc-400" style={{ borderColor: "#2a2a40" }}>
                  No players on IR.
                </p>
              )}

              <div className="flex flex-col gap-2">
                {irRoster.map((r) => {
                  const player = r.players;
                  return (
                    <div key={r.id} className="flex items-center gap-3 rounded-lg border px-4 py-3"
                      style={{ borderColor: "rgba(204,0,0,0.4)", background: "rgba(204,0,0,0.04)" }}>

                      <div className="flex-1 min-w-0">
                        <p className="font-semibold truncate">{player?.full_name ?? r.player_id}</p>
                        <p className="text-sm" style={{ color: "#CC0000" }}>
                          {player?.position ?? "?"} &middot; {player?.team ?? "FA"} &middot; Injured Reserve
                        </p>
                      </div>

                      <form action={moveFromIR}>
                        <input type="hidden" name="leagueId" value={leagueId} />
                        <input type="hidden" name="playerId" value={r.player_id} />
                        <button type="submit"
                          className="rounded px-2 py-1 text-xs font-semibold"
                          style={{ background: "rgba(0,87,255,0.2)", color: "#6fa3ff" }}>
                          Active
                        </button>
                      </form>

                      <form action={dropPlayer}>
                        <input type="hidden" name="leagueId" value={leagueId} />
                        <input type="hidden" name="playerId" value={r.player_id} />
                        <input type="hidden" name="returnTo" value="roster" />
                        <button type="submit"
                          className="rounded px-2 py-1 text-xs font-semibold"
                          style={{ background: "#1c1c2b", color: "#8a8a9a" }}>
                          Drop
                        </button>
                      </form>
                    </div>
                  );
                })}
              </div>
            </section>
          </div>

          {/* Right: activity + news */}
          <aside className="order-3 flex flex-col gap-6">
            <section className="flex flex-col gap-3">
              <h2 className="text-lg font-semibold" style={{ color: "#FFD700" }}>League Activity</h2>
              {pickList.length === 0 ? (
                <p className="rounded-lg border p-4 text-sm text-zinc-400" style={{ borderColor: "#2a2a40" }}>
                  No draft picks yet.
                </p>
              ) : (
                <div className="flex flex-col gap-2">
                  {pickList.map((pick) => (
                    <div key={pick.id} className="rounded-lg border p-3" style={{ borderColor: "#2a2a40" }}>
                      <p className="text-sm">
                        <span className="font-semibold">{pick.league_members?.team_name ?? "A manager"}</span>{" "}
                        drafted{" "}
                        <span className="font-semibold">{pick.players?.full_name ?? "a player"}</span>
                        {pick.players?.position ? ` (${pick.players.position}${pick.players.team ? ` · ${pick.players.team}` : ""})` : ""}
                      </p>
                      <p className="mt-1 text-xs text-zinc-500">
                        Round {pick.round}, Pick {pick.pick_no} &middot; {timeAgo(pick.picked_at)}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="flex flex-col gap-3">
              <h2 className="text-lg font-semibold" style={{ color: "#FFD700" }}>NFL News</h2>
              {news.length === 0 ? (
                <p className="rounded-lg border p-4 text-sm text-zinc-400" style={{ borderColor: "#2a2a40" }}>
                  Headlines unavailable right now.
                </p>
              ) : (
                <div className="flex flex-col gap-2">
                  {news.map((item) => (
                    <a key={item.link} href={item.link} target="_blank" rel="noopener noreferrer"
                      className="rounded-lg border p-3 text-sm underline-offset-2 hover:underline"
                      style={{ borderColor: "#2a2a40" }}>
                      {item.title}
                    </a>
                  ))}
                  <p className="text-xs text-zinc-500">Source: ESPN NFL headlines</p>
                </div>
              )}
            </section>
          </aside>
        </div>
      </main>
    </div>
  );
}
