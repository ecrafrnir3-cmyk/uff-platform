"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

const JOIN_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I

function generateJoinCode(): string {
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += JOIN_CODE_CHARS[Math.floor(Math.random() * JOIN_CODE_CHARS.length)];
  }
  return code;
}

// Even-numbered league sizes only (Section 9 #2: even-team enforcement).
export const LEAGUE_SIZE_OPTIONS = [4, 6, 8, 10, 12, 14, 16] as const;

type Faction = "hero" | "villain";

function parseFaction(value: FormDataEntryValue | null): Faction | null {
  return value === "hero" || value === "villain" ? value : null;
}

export async function createLeague(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const name = (formData.get("name") as string)?.trim();
  const teamName = (formData.get("teamName") as string)?.trim();
  const maxTeams = parseInt(formData.get("maxTeams") as string, 10);
  const faction = parseFaction(formData.get("faction"));

  if (!name || !teamName) {
    redirect("/dashboard?error=" + encodeURIComponent("League name and team name are required."));
  }

  if (!Number.isInteger(maxTeams) || maxTeams < 2 || maxTeams % 2 !== 0) {
    redirect("/dashboard?error=" + encodeURIComponent("League size must be an even number of teams."));
  }

  // Generate a unique 6-character join code (retry on the rare collision).
  let joinCode = generateJoinCode();
  for (let i = 0; i < 5; i++) {
    const { data: existing } = await supabase
      .from("uff_leagues")
      .select("id")
      .eq("join_code", joinCode)
      .maybeSingle();
    if (!existing) break;
    joinCode = generateJoinCode();
  }

  const { data: league, error: leagueError } = await supabase
    .from("uff_leagues")
    .insert({ name, commissioner_id: user.id, join_code: joinCode, max_teams: maxTeams })
    .select("id")
    .single();

  if (leagueError || !league) {
    redirect("/dashboard?error=" + encodeURIComponent(leagueError?.message ?? "Could not create league."));
  }

  const { error: memberError } = await supabase.from("league_members").insert({
    league_id: league.id,
    user_id: user.id,
    team_name: teamName,
    is_commissioner: true,
    faction,
  });

  if (memberError) {
    redirect("/dashboard?error=" + encodeURIComponent(memberError.message));
  }

  revalidatePath("/dashboard");
  redirect(`/dashboard/league/${league.id}`);
}

export async function joinLeague(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const joinCode = (formData.get("joinCode") as string)?.trim().toUpperCase();
  const teamName = (formData.get("teamName") as string)?.trim();
  const faction = parseFaction(formData.get("faction"));
  if (!joinCode || !teamName) {
    redirect("/dashboard?error=" + encodeURIComponent("Join code and team name are required."));
  }

  const { data: league, error: leagueError } = await supabase
    .from("uff_leagues")
    .select("id, max_teams")
    .eq("join_code", joinCode)
    .maybeSingle();

  if (leagueError || !league) {
    redirect("/dashboard?error=" + encodeURIComponent("No league found with that join code."));
  }

  const { data: members } = await supabase
    .from("league_members")
    .select("id, faction")
    .eq("league_id", league.id);

  const memberCount = members?.length ?? 0;
  if (memberCount >= league.max_teams) {
    redirect("/dashboard?error=" + encodeURIComponent("That league is already full."));
  }

  if (faction) {
    const capacity = league.max_teams / 2;
    const currentInFaction = members?.filter((m) => m.faction === faction).length ?? 0;
    if (currentInFaction >= capacity) {
      const label = faction === "hero" ? "Hero" : "Villain";
      redirect(
        "/dashboard?error=" +
          encodeURIComponent(`The ${label} side is already full for that league. Pick the other side or "Decide later".`)
      );
    }
  }

  const { error: memberError } = await supabase.from("league_members").insert({
    league_id: league.id,
    user_id: user.id,
    team_name: teamName,
    is_commissioner: false,
    faction,
  });

  if (memberError) {
    const message = memberError.code === "23505" ? "You're already in that league." : memberError.message;
    redirect("/dashboard?error=" + encodeURIComponent(message));
  }

  revalidatePath("/dashboard");
  redirect(`/dashboard/league/${league.id}`);
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
