import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

const HERO_COLOR    = "#0057FF";
const VILLAIN_COLOR = "#CC0000";
const GOLD          = "#FFD700";

function factionColor(faction: string | null) {
  if (faction === "hero")    return HERO_COLOR;
  if (faction === "villain") return VILLAIN_COLOR;
  return "#6b6b8a";
}

interface BracketSlot {
  id: string;
  round: number;
  week: number;
  slot: number;
  seed_a: number | null;
  seed_b: number | null;
  member_id_a: string | null;
  member_id_b: string | null;
  points_a: number;
  points_b: number;
  winner_id: string | null;
  is_complete: boolean;
}

interface Member {
  id: string;
  team_name: string;
  faction: "hero" | "villain" | null;
  profiles: { display_name: string | null; username: string | null } | null;
}

function memberName(m: Member | undefined) {
  if (!m) return "TBD";
  return m.profiles?.display_name ?? m.profiles?.username ?? m.team_name;
}

function SeedBadge({ seed }: { seed: number | null }) {
  if (!seed) return null;
  return (
    <span
      className="inline-flex items-center justify-center text-[10px] font-bold w-5 h-5 rounded-full shrink-0"
      style={{ background: "#1c1c2b", color: "#8888aa", border: "1px solid #2a2a40" }}
    >
      {seed}
    </span>
  );
}

function MatchupCard({
  slot,
  memberA,
  memberB,
  label,
}: {
  slot: BracketSlot;
  memberA: Member | undefined;
  memberB: Member | undefined;
  label: string;
}) {
  const aWon = slot.is_complete && slot.winner_id === slot.member_id_a;
  const bWon = slot.is_complete && slot.winner_id === slot.member_id_b;
  const tbd  = !slot.member_id_a || !slot.member_id_b;

  return (
    <div
      className="flex flex-col rounded-xl border overflow-hidden"
      style={{ borderColor: slot.is_complete ? GOLD + "55" : "#2a2a40", minWidth: 220 }}
    >
      {/* Label */}
      <div
        className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider"
        style={{ background: "#1c1c2b", color: "#6b6b8a", borderBottom: "1px solid #2a2a40" }}
      >
        {label} · Wk {slot.week}
      </div>

      {/* Team A */}
      <div
        className="flex items-center gap-2 px-3 py-2.5 border-b"
        style={{
          borderColor: "#2a2a40",
          background: aWon ? "rgba(255,215,0,0.05)" : "#0d0d1a",
        }}
      >
        <SeedBadge seed={slot.seed_a} />
        <span
          className="flex-1 text-sm font-semibold truncate"
          style={{ color: memberA ? factionColor(memberA.faction) : "#6b6b8a" }}
        >
          {tbd && !slot.member_id_a ? "TBD" : memberName(memberA)}
        </span>
        {slot.is_complete && (
          <span className="text-sm font-black tabular-nums" style={{ color: aWon ? GOLD : "#6b6b8a" }}>
            {slot.points_a.toFixed(2)}
          </span>
        )}
        {aWon && <span className="text-xs" style={{ color: GOLD }}>🏆</span>}
      </div>

      {/* Team B */}
      <div
        className="flex items-center gap-2 px-3 py-2.5"
        style={{ background: bWon ? "rgba(255,215,0,0.05)" : "#0d0d1a" }}
      >
        <SeedBadge seed={slot.seed_b} />
        <span
          className="flex-1 text-sm font-semibold truncate"
          style={{ color: memberB ? factionColor(memberB.faction) : "#6b6b8a" }}
        >
          {tbd && !slot.member_id_b ? "TBD" : memberName(memberB)}
        </span>
        {slot.is_complete && (
          <span className="text-sm font-black tabular-nums" style={{ color: bWon ? GOLD : "#6b6b8a" }}>
            {slot.points_b.toFixed(2)}
          </span>
        )}
        {bWon && <span className="text-xs" style={{ color: GOLD }}>🏆</span>}
      </div>
    </div>
  );
}

export default async function PlayoffsPage({
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
    .select("id, name, season, playoff_teams, playoff_start_week, championship_week, season_weeks, commissioner_id")
    .eq("id", leagueId)
    .maybeSingle();
  if (!league) redirect("/dashboard");

  const { data: me } = await supabase
    .from("league_members")
    .select("id")
    .eq("league_id", leagueId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!me) redirect("/dashboard");

  // Fetch bracket
  const { data: bracketRaw } = await supabase
    .from("uff_playoff_bracket")
    .select("id, round, week, slot, seed_a, seed_b, member_id_a, member_id_b, points_a, points_b, winner_id, is_complete")
    .eq("league_id", leagueId)
    .eq("season", league.season)
    .order("round")
    .order("slot");

  const bracket = (bracketRaw ?? []) as BracketSlot[];
  const hasPlayoffs = bracket.length > 0;

  // Fetch all members for name resolution
  const { data: membersRaw } = await supabase
    .from("league_members")
    .select("id, team_name, faction, profiles(display_name, username)")
    .eq("league_id", leagueId);
  const members = (membersRaw ?? []) as unknown as Member[];
  const memberMap = new Map(members.map((m) => [m.id, m]));

  // Group bracket by round
  const round1 = bracket.filter((b) => b.round === 1); // wildcard
  const round2 = bracket.filter((b) => b.round === 2); // semis
  const round3 = bracket.filter((b) => b.round === 3); // championship

  // Regular season standings for seeding reference
  const { data: matchupRows } = await supabase
    .from("uff_matchups")
    .select("matchup_id, member_id, points, void_result, is_complete")
    .eq("league_id", leagueId)
    .eq("season", league.season)
    .eq("is_complete", true)
    .eq("is_playoff", false);

  const standings: Record<string, { wins: number; losses: number; pf: number }> = {};
  const byMatchup: Record<number, typeof matchupRows extends (infer R)[] | null ? R[] : never[]> = {};
  for (const r of matchupRows ?? []) {
    if (!byMatchup[r.matchup_id]) byMatchup[r.matchup_id] = [];
    (byMatchup[r.matchup_id] as typeof r[]).push(r);
  }
  for (const pair of Object.values(byMatchup)) {
    for (const r of pair) {
      if (!standings[r.member_id]) standings[r.member_id] = { wins: 0, losses: 0, pf: 0 };
      standings[r.member_id].pf += r.points;
    }
    if (pair.length === 2) {
      const [a, b] = pair as [typeof pair[0], typeof pair[0]];
      if (!standings[a.member_id]) standings[a.member_id] = { wins: 0, losses: 0, pf: 0 };
      if (!standings[b.member_id]) standings[b.member_id] = { wins: 0, losses: 0, pf: 0 };
      if (a.void_result && b.points > a.points) { standings[b.member_id].wins++; }
      else if (b.void_result && a.points > b.points) { standings[a.member_id].wins++; }
      else if (a.points > b.points) { standings[a.member_id].wins++; standings[b.member_id].losses++; }
      else if (b.points > a.points) { standings[b.member_id].wins++; standings[a.member_id].losses++; }
    }
  }

  const sortedStandings = Object.entries(standings)
    .sort(([, a], [, b]) => b.wins - a.wins || b.pf - a.pf)
    .slice(0, league.playoff_teams ?? 6);

  const isCommissioner = league.commissioner_id === user.id;

  const playoffWeeks = league.championship_week ?? 17;
  const startWeek    = league.playoff_start_week ?? 15;

  return (
    <div className="min-h-screen px-6 py-12 sm:px-12" style={{ background: "#0d0d1a", color: "#f4f4f8" }}>
      <main className="mx-auto flex max-w-5xl flex-col gap-10">

        {/* Header */}
        <header className="flex flex-col gap-2">
          <Link href={`/dashboard/league/${leagueId}`} className="text-sm underline" style={{ color: HERO_COLOR }}>
            &larr; Back to {league.name}
          </Link>
          <p className="text-sm uppercase tracking-[0.3em]" style={{ color: GOLD }}>
            Ultimate Fantasy Football
          </p>
          <h1 className="text-3xl sm:text-4xl font-black" style={{ fontFamily: "var(--font-display, sans-serif)", color: GOLD }}>
            Playoffs
          </h1>
          <p className="text-sm" style={{ color: "#8888aa" }}>
            Season {league.season} · {league.playoff_teams ?? 6} teams · Wks {startWeek}–{playoffWeeks} · Championship Wk {league.championship_week ?? 17}
          </p>
        </header>

        {!hasPlayoffs ? (
          <div className="flex flex-col gap-4">
            <div
              className="rounded-lg border p-8 text-center"
              style={{ borderColor: "#2a2a40" }}
            >
              <p className="text-lg font-semibold mb-2" style={{ color: GOLD }}>Bracket Not Yet Set</p>
              <p className="text-sm mb-4" style={{ color: "#8888aa" }}>
                The playoff bracket will appear here once the commissioner seeds it after the regular season ends.
              </p>
              {isCommissioner && (
                <Link
                  href={`/dashboard/league/${leagueId}/settings`}
                  className="inline-block rounded-md px-4 py-2 text-sm font-semibold"
                  style={{ background: GOLD, color: "#0d0d1a" }}
                >
                  Go to Settings → Seed Playoffs
                </Link>
              )}
            </div>

            {/* Regular season standings preview */}
            {sortedStandings.length > 0 && (
              <section className="flex flex-col gap-3">
                <p className="text-xs font-bold uppercase tracking-wider" style={{ color: "#6b6b8a" }}>
                  Current Playoff Picture (top {league.playoff_teams ?? 6})
                </p>
                <div className="flex flex-col gap-1.5">
                  {sortedStandings.map(([memberId, s], i) => {
                    const m = memberMap.get(memberId);
                    const fc = factionColor(m?.faction ?? null);
                    return (
                      <div
                        key={memberId}
                        className="flex items-center gap-3 rounded-lg border px-4 py-2.5"
                        style={{
                          borderColor: i < 2 ? GOLD + "44" : "#2a2a40",
                          background: i < 2 ? "rgba(255,215,0,0.03)" : "#0d0d1a",
                        }}
                      >
                        <span className="text-sm font-black tabular-nums w-5 text-center" style={{ color: i < 2 ? GOLD : "#6b6b8a" }}>
                          {i + 1}
                        </span>
                        <span className="h-2 w-2 rounded-full shrink-0" style={{ background: fc }} />
                        <span className="flex-1 text-sm font-semibold" style={{ color: fc }}>
                          {m?.team_name ?? "Unknown"}
                        </span>
                        <span className="text-sm tabular-nums" style={{ color: "#f4f4f8" }}>
                          {s.wins}-{s.losses}
                        </span>
                        <span className="text-xs tabular-nums" style={{ color: "#6b6b8a" }}>
                          {s.pf.toFixed(1)} PF
                        </span>
                        {i < 2 && (
                          <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full" style={{ background: GOLD + "22", color: GOLD }}>
                            Bye
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-10">
            {/* Championship banner if complete */}
            {round3[0]?.is_complete && round3[0]?.winner_id && (() => {
              const champ = memberMap.get(round3[0].winner_id!);
              return (
                <div
                  className="rounded-xl border-2 p-6 text-center"
                  style={{ borderColor: GOLD, background: "rgba(255,215,0,0.04)" }}
                >
                  <p className="text-xs font-bold uppercase tracking-widest mb-2" style={{ color: GOLD }}>
                    🏆 {league.season} Champion
                  </p>
                  <p className="text-3xl font-black" style={{ color: GOLD }}>
                    {champ?.team_name ?? "Unknown"}
                  </p>
                  <p className="text-sm mt-1" style={{ color: "#8888aa" }}>
                    {memberName(champ)} · {champ?.faction ?? ""}
                  </p>
                </div>
              );
            })()}

            {/* Bracket */}
            <div className="overflow-x-auto">
              <div className="flex gap-8 items-start min-w-max pb-4">

                {/* Round 1 — Wildcard */}
                {round1.length > 0 && (
                  <div className="flex flex-col gap-6">
                    <p className="text-xs font-bold uppercase tracking-wider text-center" style={{ color: "#6b6b8a" }}>
                      Wildcard · Wk {startWeek}
                    </p>
                    {round1.map((slot) => (
                      <MatchupCard
                        key={slot.id}
                        slot={slot}
                        memberA={memberMap.get(slot.member_id_a ?? "") }
                        memberB={memberMap.get(slot.member_id_b ?? "") }
                        label={`R1 · Slot ${slot.slot}`}
                      />
                    ))}
                  </div>
                )}

                {/* Arrow */}
                {round1.length > 0 && round2.length > 0 && (
                  <div className="flex items-center self-center" style={{ color: "#2a2a40", fontSize: 24 }}>→</div>
                )}

                {/* Round 2 — Semis */}
                {round2.length > 0 && (
                  <div className="flex flex-col gap-6">
                    <p className="text-xs font-bold uppercase tracking-wider text-center" style={{ color: "#6b6b8a" }}>
                      Semifinals · Wk {startWeek + 1}
                    </p>
                    {round2.map((slot) => (
                      <MatchupCard
                        key={slot.id}
                        slot={slot}
                        memberA={memberMap.get(slot.member_id_a ?? "") }
                        memberB={memberMap.get(slot.member_id_b ?? "") }
                        label={`R2 · Slot ${slot.slot}`}
                      />
                    ))}
                  </div>
                )}

                {/* Arrow */}
                {round2.length > 0 && round3.length > 0 && (
                  <div className="flex items-center self-center" style={{ color: "#2a2a40", fontSize: 24 }}>→</div>
                )}

                {/* Round 3 — Championship */}
                {round3.length > 0 && (
                  <div className="flex flex-col gap-6">
                    <p className="text-xs font-bold uppercase tracking-wider text-center" style={{ color: GOLD }}>
                      🏆 Championship · Wk {league.championship_week ?? 17}
                    </p>
                    {round3.map((slot) => (
                      <MatchupCard
                        key={slot.id}
                        slot={slot}
                        memberA={memberMap.get(slot.member_id_a ?? "") }
                        memberB={memberMap.get(slot.member_id_b ?? "") }
                        label="Championship"
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Legend */}
            <div className="flex items-center gap-4 text-xs" style={{ color: "#6b6b8a" }}>
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full" style={{ background: HERO_COLOR }} /> Hero
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full" style={{ background: VILLAIN_COLOR }} /> Villain
              </span>
              <span className="flex items-center gap-1.5">
                <span>🏆</span> Winner
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-flex items-center justify-center text-[10px] font-bold w-5 h-5 rounded-full" style={{ background: "#1c1c2b", color: "#8888aa", border: "1px solid #2a2a40" }}>1</span> Seed
              </span>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
