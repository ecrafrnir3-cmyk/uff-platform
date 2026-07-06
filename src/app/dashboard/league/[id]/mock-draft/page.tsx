import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import MockDraftRoom from "./MockDraftRoom";

interface MemberRow {
  id: string;
  team_name: string;
  faction: "hero" | "villain" | null;
  user_id: string;
  profiles: { display_name: string | null; username: string } | null;
}

interface PowerAssignmentRow {
  member_id: string;
  round: number;
  draft_powers: {
    id: number;
    name: string;
    category: string | null;
    description: string;
    tied_position: string | null;
  } | null;
}

export default async function MockDraftPage({
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
    .select("id, name, draft_order, max_teams, draft_rounds, commissioner_id")
    .eq("id", leagueId)
    .maybeSingle();

  if (!league) redirect("/dashboard?error=" + encodeURIComponent("League not found."));

  const { data: members } = await supabase
    .from("league_members")
    .select("id, team_name, faction, user_id, profiles(display_name, username)")
    .eq("league_id", leagueId)
    .order("joined_at", { ascending: true })
    .returns<MemberRow[]>();

  const me = (members ?? []).find((m) => m.user_id === user.id);
  if (!me) redirect("/dashboard?error=" + encodeURIComponent("You're not a member of that league."));

  const memberIds = (members ?? []).map((m) => m.id);

  // Load ALL members' power assignments so CPU picks can use real powers
  const { data: allPowerRows } = await supabase
    .from("draft_power_assignments")
    .select("member_id, round, draft_powers(id, name, category, description, tied_position)")
    .in("member_id", memberIds)
    .order("round", { ascending: true })
    .returns<PowerAssignmentRow[]>();

  // Load top players by ADP (enough to cover the full draft + extras)
  const limit = Math.max(300, league.max_teams * league.draft_rounds * 2);
  const { data: players } = await supabase
    .from("players")
    .select("id, full_name, position, team, adp, injury_status")
    .not("position", "is", null)
    .order("adp", { ascending: true, nullsFirst: false })
    .limit(limit);

  return (
    <MockDraftRoom
      league={{
        id: league.id,
        name: league.name,
        draft_order: (league.draft_order as string[]) ?? [],
        max_teams: league.max_teams,
        draft_rounds: league.draft_rounds,
      }}
      members={members ?? []}
      myMemberId={me.id}
      allPowerRows={allPowerRows ?? []}
      players={players ?? []}
    />
  );
}
