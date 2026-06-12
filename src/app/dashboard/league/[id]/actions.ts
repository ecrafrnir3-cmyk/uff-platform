"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

type Faction = "hero" | "villain";

function parseFaction(value: FormDataEntryValue | null): Faction | null {
  return value === "hero" || value === "villain" ? value : null;
}

/** A manager picks (or changes/clears) their own faction. Locked once the draft starts. */
export async function setMyFaction(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const leagueId = formData.get("leagueId") as string;
  const faction = parseFaction(formData.get("faction"));

  const { data: league } = await supabase
    .from("uff_leagues")
    .select("draft_status, max_teams")
    .eq("id", leagueId)
    .maybeSingle();

  if (!league) {
    redirect("/dashboard?error=" + encodeURIComponent("League not found."));
  }

  if (league.draft_status !== "not_started") {
    redirect(`/dashboard/league/${leagueId}?error=` + encodeURIComponent("Factions are locked once the draft starts."));
  }

  if (faction) {
    const { data: members } = await supabase
      .from("league_members")
      .select("id, faction, user_id")
      .eq("league_id", leagueId);

    const capacity = league.max_teams / 2;
    const currentInFaction =
      members?.filter((m) => m.faction === faction && m.user_id !== user.id).length ?? 0;

    if (currentInFaction >= capacity) {
      const label = faction === "hero" ? "Hero" : "Villain";
      redirect(
        `/dashboard/league/${leagueId}?error=` +
          encodeURIComponent(`The ${label} side is already full. Pick the other side instead.`)
      );
    }
  }

  const { error } = await supabase
    .from("league_members")
    .update({ faction })
    .eq("league_id", leagueId)
    .eq("user_id", user.id);

  if (error) {
    redirect(`/dashboard/league/${leagueId}?error=` + encodeURIComponent(error.message));
  }

  revalidatePath(`/dashboard/league/${leagueId}`);
  redirect(`/dashboard/league/${leagueId}`);
}

/** Commissioner-only: auto-balance any unassigned members to an even Hero/Villain split. */
export async function randomizeFactions(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const leagueId = formData.get("leagueId") as string;

  const { data: league } = await supabase
    .from("uff_leagues")
    .select("commissioner_id, draft_status")
    .eq("id", leagueId)
    .maybeSingle();

  if (!league) {
    redirect("/dashboard?error=" + encodeURIComponent("League not found."));
  }

  if (league.commissioner_id !== user.id) {
    redirect(`/dashboard/league/${leagueId}?error=` + encodeURIComponent("Only the commissioner can randomize factions."));
  }

  if (league.draft_status !== "not_started") {
    redirect(`/dashboard/league/${leagueId}?error=` + encodeURIComponent("Factions are locked once the draft starts."));
  }

  const { data: members, error: membersError } = await supabase
    .from("league_members")
    .select("id, faction")
    .eq("league_id", leagueId);

  if (membersError || !members) {
    redirect(`/dashboard/league/${leagueId}?error=` + encodeURIComponent(membersError?.message ?? "Could not load members."));
  }

  let heroCount = members.filter((m) => m.faction === "hero").length;
  let villainCount = members.filter((m) => m.faction === "villain").length;
  const unassigned = members.filter((m) => !m.faction);

  // Fisher-Yates shuffle so the assignment order isn't predictable.
  for (let i = unassigned.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [unassigned[i], unassigned[j]] = [unassigned[j], unassigned[i]];
  }

  for (const member of unassigned) {
    const faction: Faction = heroCount <= villainCount ? "hero" : "villain";
    if (faction === "hero") heroCount++;
    else villainCount++;

    const { error } = await supabase.from("league_members").update({ faction }).eq("id", member.id);

    if (error) {
      redirect(`/dashboard/league/${leagueId}?error=` + encodeURIComponent(error.message));
    }
  }

  revalidatePath(`/dashboard/league/${leagueId}`);
  redirect(`/dashboard/league/${leagueId}`);
}
