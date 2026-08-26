import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import WarMeter from "@/components/story/WarMeter";
import FreeLegendsBoard, { type FreeLegend } from "@/components/story/FreeLegendsBoard";
import BattleReport, { type BattleLine } from "@/components/story/BattleReport";
import type { Faction } from "@/lib/story-engine/rules";

interface FreeRow {
  character_id: number;
  rank: number;
  legend_points: number;
  uff_characters: unknown;
}
interface BattleRowDb {
  week: number;
  kind: BattleLine["kind"];
  winner: BattleLine["winner"];
  winner_character_id: number | null;
  narration: string | null;
}

export default async function WarRoomPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: leagueId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: league } = await supabase.from("uff_leagues").select("id, name").eq("id", leagueId).maybeSingle();
  if (!league) redirect("/dashboard?error=" + encodeURIComponent("League not found."));

  const { data: me } = await supabase
    .from("league_members")
    .select("id")
    .eq("league_id", leagueId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!me) redirect("/dashboard?error=" + encodeURIComponent("You're not a member of that league."));

  const { data: chars } = await supabase.from("uff_characters").select("id, name");
  const nameById = new Map<number, string>();
  for (const c of (chars ?? []) as { id: number; name: string }[]) nameById.set(c.id, c.name);

  const { data: war } = await supabase
    .from("alliance_war")
    .select("week, hero_battle_wins, villain_battle_wins, front_position")
    .eq("league_id", leagueId)
    .order("week", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: fl } = await supabase
    .from("character_legend")
    .select("character_id, rank, legend_points, uff_characters(name, epithet, faction)")
    .eq("league_id", leagueId)
    .eq("is_free_legend", true);
  const freeLegends: FreeLegend[] = ((fl ?? []) as FreeRow[])
    .map((r) => {
      const c = (Array.isArray(r.uff_characters) ? r.uff_characters[0] : r.uff_characters) as
        | { name?: string; epithet?: string; faction?: Faction }
        | null;
      return {
        character_id: r.character_id,
        name: c?.name ?? "?",
        epithet: c?.epithet ?? "",
        faction: (c?.faction ?? "hero") as Faction,
        rank: r.rank,
        legend_points: r.legend_points,
      };
    })
    .sort((a, b) => b.legend_points - a.legend_points);

  const { data: bs } = await supabase
    .from("story_battles")
    .select("week, kind, winner, winner_character_id, narration")
    .eq("league_id", leagueId)
    .order("week", { ascending: false })
    .order("id", { ascending: false })
    .limit(14);
  const battles: BattleLine[] = ((bs ?? []) as BattleRowDb[]).map((b) => ({
    week: b.week,
    kind: b.kind,
    winner: b.winner,
    winnerName: b.winner_character_id != null ? nameById.get(b.winner_character_id) ?? null : null,
    narration: b.narration ?? "",
  }));

  return (
    <div className="min-h-screen px-4 py-10 sm:px-8" style={{ background: "#0d0d1a", color: "#f4f4f8" }}>
      <main className="mx-auto flex max-w-4xl flex-col gap-6">
        <header className="flex flex-col gap-2">
          <Link href={`/dashboard/league/${leagueId}`} className="text-sm underline" style={{ color: "#0057FF" }}>
            &larr; Back to {league.name}
          </Link>
          <h1 className="text-3xl sm:text-4xl" style={{ fontFamily: "var(--font-display, sans-serif)", color: "#FFD700" }}>
            The War Room
          </h1>
          <p className="text-sm" style={{ color: "#a0a0c0" }}>
            The story of {league.name} — the alliance war, the Free Legends, and the week&apos;s battles.
          </p>
        </header>

        <WarMeter
          front={war?.front_position ?? 0}
          heroWins={war?.hero_battle_wins ?? 0}
          villainWins={war?.villain_battle_wins ?? 0}
          week={war?.week ?? null}
        />
        <FreeLegendsBoard legends={freeLegends} />
        <BattleReport battles={battles} />

        <p className="text-center text-xs" style={{ color: "#6b6b8a" }}>
          Legend rises only from the story — it never touches your fantasy score or standings.
        </p>
      </main>
    </div>
  );
}
