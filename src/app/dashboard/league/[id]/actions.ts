"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { notifyNextPicker } from "@/lib/draft-notify";
import { syncCharacterForFaction, syncAllCharactersForLeague } from "@/lib/characters";

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

  // First overall pick is on the clock the moment the draft opens — without
  // this, the #1 picker never hears about it (notifyNextPicker otherwise only
  // fires AFTER a pick lands). Never throws.
  await notifyNextPicker(supabase, leagueId);

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

  // Cast the manager as a character of their (new) faction.
  const { data: meRow } = await supabase
    .from("league_members")
    .select("id")
    .eq("league_id", leagueId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (meRow?.id) await syncCharacterForFaction(leagueId, meRow.id as string, faction);

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

  // Cast any newly-factioned managers as characters.
  await syncAllCharactersForLeague(leagueId);

  revalidatePath(`/dashboard/league/${leagueId}`);
  redirect(`/dashboard/league/${leagueId}`);
}

/**
 * Set the manager's choice for their weekly token (Position Power or Second Wind).
 * Writes `choice` to weekly_token_assignments. Only valid while status = 'pending'.
 */
export async function setTokenChoice(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const leagueId = formData.get("leagueId") as string;
  const week     = parseInt(formData.get("week") as string);
  const choice   = formData.get("choice") as string;

  if (!leagueId || !week || !choice) {
    redirect(`/dashboard/league/${leagueId}/roster?error=` + encodeURIComponent("Invalid token choice."));
  }

  const { data: me } = await supabase
    .from("league_members")
    .select("id")
    .eq("league_id", leagueId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!me) redirect(`/dashboard/league/${leagueId}/roster?error=` + encodeURIComponent("Not a member."));

  const { error } = await supabase
    .from("weekly_token_assignments")
    .update({ choice })
    .eq("league_id", leagueId)
    .eq("member_id", me.id)
    .eq("week", week)
    .eq("status", "pending");

  if (error) {
    redirect(`/dashboard/league/${leagueId}/roster?error=` + encodeURIComponent(error.message));
  }

  revalidatePath(`/dashboard/league/${leagueId}/roster`);
  redirect(`/dashboard/league/${leagueId}/roster`);
}
