import Link from "next/link";
import PlayerPhoto from "./PlayerPhoto";
import { moveToIR } from "../player-actions";
import DropButton from "./DropButton";

interface RosterRow {
  id: string;
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

interface TeamFactionRow { abbr: string; faction: string; }

interface PlayerStats {
  pts_ppr?: number;
}

interface Props {
  activeRoster: RosterRow[];
  leagueId: string;
  draftRounds: number;
  irSlotsUsed: number;
  irSlotsTotal: number;
  currentLineup: Record<string, string>;
  teams: TeamFactionRow[];
  memberFaction: string | null;
  factionAccent: string;
}

const VILLAIN_COLOR = "#CC0000";
const HERO_COLOR    = "#0057FF";

const POS_COLOR: Record<string, string> = {
  QB:  "#0057FF",
  RB:  "#3DDC84",
  WR:  "#FFD700",
  TE:  "#FF6B35",
  K:   "#8a8a9a",
  DEF: VILLAIN_COLOR,
  DST: VILLAIN_COLOR,
};

function PosBadge({ position }: { position: string | null }) {
  const pos   = (position ?? "?").toUpperCase();
  const color = POS_COLOR[pos] ?? "#8a8a9a";
  return (
    <span
      className="inline-block w-8 rounded text-center text-xs font-bold leading-5 uppercase"
      style={{ background: color + "22", color }}
    >
      {pos}
    </span>
  );
}

function fmt(n: number | undefined, dec = 0): string {
  if (n === undefined || n === 0) return "\u2014";
  return dec > 0 ? n.toFixed(dec) : Math.round(n).toString();
}

async function fetchPlayerStats(playerId: string): Promise<PlayerStats> {
  try {
    const res = await fetch(
      "https://api.sleeper.app/v1/stats/nfl/player/" + playerId +
      "?season_type=regular&season=2024&grouping=season",
      { next: { revalidate: 86400 } }
    );
    if (!res.ok) return {};
    const data = await res.json();
    return (data?.stats ?? {}) as PlayerStats;
  } catch { return {}; }
}

export default async function RosterStatsTable({
  activeRoster,
  leagueId,
  draftRounds,
  irSlotsUsed,
  irSlotsTotal,
  currentLineup,
  teams,
  memberFaction,
  factionAccent,
}: Props) {
  if (activeRoster.length === 0) {
    return (
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold" style={{ color: "#FFD700" }}>
            Active Roster (0 / {draftRounds})
          </h2>
        </div>
        <p className="rounded-lg border p-5 text-sm" style={{ borderColor: "#2a2a40", color: "#8a8a9a" }}>
          No active players &mdash; draft players or add from free agency.
        </p>
      </section>
    );
  }

  // Fetch 2024 season stats for every active player — runs in parallel
  const statsResults = await Promise.all(activeRoster.map((r) => fetchPlayerStats(r.player_id)));
  const statsMap: Record<string, PlayerStats> = {};
  activeRoster.forEach((r, i) => { statsMap[r.player_id] = statsResults[i]; });

  const teamFaction = new Map(teams.map((t) => [t.abbr, t.faction]));

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold" style={{ color: "#FFD700" }}>
          Active Roster ({activeRoster.length} / {draftRounds})
        </h2>
        <Link
          href={`/dashboard/league/${leagueId}/free-agents`}
          className="text-xs font-semibold underline"
          style={{ color: HERO_COLOR }}
        >
          + Add player
        </Link>
      </div>

      <div className="overflow-x-auto rounded-lg border" style={{ borderColor: "#2a2a40" }}>
        <table className="w-full text-sm" style={{ borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "#15151f", color: "#8a8a9a" }}>
              <th className="px-3 py-2 text-left font-semibold uppercase tracking-wider text-xs">Player</th>
              <th className="px-2 py-2 text-center text-xs">Slot</th>
              <th className="px-2 py-2 text-right text-xs" title="2024 Season Fantasy Pts (PPR)">2024 Pts</th>
              <th className="px-2 py-2 text-xs"></th>
            </tr>
          </thead>
          <tbody>
            {activeRoster.map((r) => {
              const player    = r.players;
              const pFaction  = player?.team ? teamFaction.get(player.team) ?? null : null;
              const matches   = memberFaction !== null && pFaction === memberFaction;
              const isIR      = player?.status === "Injured Reserve";
              const isStarter = Object.values(currentLineup).includes(r.player_id);
              const s         = statsMap[r.player_id] ?? {};
              const accentCol = matches ? factionAccent : "#2a2a40";

              return (
                <tr
                  key={r.id}
                  className="border-t"
                  style={{ borderColor: "#2a2a40", borderLeft: `3px solid ${accentCol}` }}
                >
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <PlayerPhoto playerId={r.player_id} size={30} position={player?.position ?? null} />
                      <PosBadge position={player?.position ?? null} />
                      <div className="min-w-0">
                        <p className="font-semibold truncate">{player?.full_name ?? r.player_id}</p>
                        <p className="text-xs truncate" style={{ color: "#8a8a9a" }}>
                          {player?.team ?? "FA"}
                          {player?.status && player.status !== "Active" && (
                            <span
                              className="ml-1 font-semibold"
                              style={{ color: isIR ? VILLAIN_COLOR : "#FFD700" }}
                            >
                              &middot; {player.status}
                            </span>
                          )}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="px-2 py-2 text-center">
                    <span
                      className="inline-block rounded px-1.5 text-xs font-bold"
                      style={{
                        background: isStarter ? "rgba(61,220,132,0.15)" : "#1c1c2b",
                        color:      isStarter ? "#3DDC84"               : "#8a8a9a",
                      }}
                    >
                      {isStarter ? "S" : "B"}
                    </span>
                  </td>
                  <td
                    className="px-2 py-2 text-right font-bold tabular-nums"
                    style={{ color: "#FFD700" }}
                  >
                    {fmt(s.pts_ppr, 1)}
                  </td>
                  <td className="px-2 py-2">
                    <div className="flex items-center gap-1">
                      {isIR && irSlotsUsed < irSlotsTotal && (
                        <form action={moveToIR}>
                          <input type="hidden" name="leagueId" value={leagueId} />
                          <input type="hidden" name="playerId" value={r.player_id} />
                          <button
                            type="submit"
                            className="rounded px-2 py-0.5 text-xs font-semibold"
                            style={{ background: "rgba(204,0,0,0.2)", color: "#ff8a8a" }}
                          >
                            IR
                          </button>
                        </form>
                      )}
                      <DropButton
                        leagueId={leagueId}
                        playerId={r.player_id}
                        playerName={r.players?.full_name ?? "this player"}
                        returnTo="roster"
                      />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs" style={{ color: "#3a3a50" }}>
        2024 PPR season totals (via Sleeper). Live scoring begins Week 1, 2026.
      </p>
    </section>
  );
}
