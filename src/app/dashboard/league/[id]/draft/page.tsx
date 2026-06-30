import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import DraftRoom from "./DraftRoom";

interface MemberRow {
  id: string;
  team_name: string;
  faction: "hero" | "villain" | null;
  user_id: string;
  profiles: { display_name: string | null; username: string } | null;
}

interface PickRow {
  id: string;
  round: number;
  pick_no: number;
  member_id: string;
  player_id: string;
  picked_at: string;
  players: { full_name: string; position: string | null; team: string | null } | null;
}

interface PowerRow {
  round: number;
  draft_powers: {
    id: number;
    name: string;
    category: string | null;
    description: string;
    tied_position: string | null;
  } | null;
}

export default async function DraftPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: leagueId } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: league } = await supabase
    .from("uff_leagues")
    .select("id, name, season, draft_status, draft_order, max_teams, draft_rounds, commissioner_id, pick_clock_seconds")
    .eq("id", leagueId)
    .maybeSingle();

  if (!league) redirect("/dashboard?error=" + encodeURIComponent("League not found."));

  // No redirect for "not_started" -- DraftRoom shows a pre-draft lobby instead.

  const { data: members } = await supabase
    .from("league_members")
    .select("id, team_name, faction, user_id, profiles(display_name, username)")
    .eq("league_id", leagueId)
    .order("joined_at", { ascending: true })
    .returns<MemberRow[]>();

  const me = (members ?? []).find((m) => m.user_id === user.id);
  if (!me) redirect("/dashboard?error=" + encodeURIComponent("You're not a member of that league."));

  const [{ data: picks }, { data: myPowers }, { data: watchlistRows }] = await Promise.all([
    supabase
      .from("uff_draft_picks")
      .select("id, round, pick_no, member_id, player_id, picked_at, players(full_name, position, team)")
      .eq("league_id", leagueId)
      .order("pick_no", { ascending: true })
      .returns<PickRow[]>(),
    supabase
      .from("draft_power_assignments")
      .select("round, draft_powers(id, name, category, description, tied_position)")
      .eq("member_id", me.id)
      .order("round", { ascending: true })
      .returns<PowerRow[]>(),
    supabase
      .from("uff_watchlist")
      .select("player_id, players(full_name, position, team, injury_status)")
      .eq("member_id", me.id)
      .returns<{ player_id: string; players: { full_name: string; position: string | null; team: string | null; injury_status: string | null } | null }[]>(),
  ]);

  return (
    <DraftRoom
      league={{
        id: league.id,
        name: league.name,
        draft_status: league.draft_status,
        draft_order: (league.draft_order as string[]) ?? [],
        max_teams: league.max_teams,
        draft_rounds: league.draft_rounds,
        pick_clock_seconds: (league.pick_clock_seconds as number | null) ?? null,
      }}
      members={members ?? []}
      myMemberId={me.id}
      isCommissioner={league.commissioner_id === user.id}
      initialPicks={picks ?? []}
      myPowers={myPowers ?? []}
      initialWatchlist={(watchlistRows ?? []).map((r) => r.player_id)}
    />
  );
}
