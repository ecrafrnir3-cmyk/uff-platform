"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

/** Commissioner starts the draft. Calls the start_draft RPC which shuffles order and deals powers. */
export async function startDraft(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const leagueId = formData.get("leagueId") as string;

  const { error } = await supabase.rpc("start_draft", {
    p_league_id: leagueId,
    p_user_id: user.id,
  });

  if (error) {
    redirect(`/dashboard/league/${leagueId}?error=` + encodeURIComponent(error.message));
  }

  revalidatePath(`/dashboard/league/${leagueId}`);
  redirect(`/dashboard/league/${leagueId}/draft`);
}

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

/** Commissioner-only: auto-balance any unassigned members to an even Hero/Villain split.
 *  Uses a single atomic Postgres RPC so a partial failure can never leave the
 *  league in a broken half-assigned state. */
export async function randomizeFactions(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const leagueId = formData.get("leagueId") as string;

  const { error } = await supabase.rpc("randomize_unassigned_factions", {
    p_league_id: leagueId,
    p_user_id: user.id,
  });

  if (error) {
    redirect(`/dashboard/league/${leagueId}?error=` + encodeURIComponent(error.message));
  }

  revalidatePath(`/dashboard/league/${leagueId}`);
  redirect(`/dashboard/league/${leagueId}`);
}
