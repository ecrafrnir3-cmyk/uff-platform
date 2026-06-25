"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

function rosterPaths(leagueId: string) {
  return [
    `/dashboard/league/${leagueId}/roster`,
    `/dashboard/league/${leagueId}/free-agents`,
    `/dashboard/league/${leagueId}/matchups`,
  ];
}

export async function addPlayer(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const leagueId = formData.get("leagueId") as string;
  const playerId = formData.get("playerId") as string;

  const { error } = await supabase.rpc("add_player", {
    p_league_id: leagueId,
    p_user_id: user.id,
    p_player_id: playerId,
  });

  if (error) {
    redirect(
      `/dashboard/league/${leagueId}/free-agents?error=` +
        encodeURIComponent(error.message)
    );
  }

  rosterPaths(leagueId).forEach((p) => revalidatePath(p));
  redirect(`/dashboard/league/${leagueId}/free-agents?added=1`);
}

export async function dropPlayer(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const leagueId = formData.get("leagueId") as string;
  const playerId = formData.get("playerId") as string;
  const returnTo = (formData.get("returnTo") as string) ?? "roster";

  const { error } = await supabase.rpc("drop_player", {
    p_league_id: leagueId,
    p_user_id: user.id,
    p_player_id: playerId,
  });

  if (error) {
    redirect(
      `/dashboard/league/${leagueId}/${returnTo}?error=` +
        encodeURIComponent(error.message)
    );
  }

  rosterPaths(leagueId).forEach((p) => revalidatePath(p));
  redirect(`/dashboard/league/${leagueId}/${returnTo}?dropped=1`);
}

export async function moveToIR(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const leagueId = formData.get("leagueId") as string;
  const playerId = formData.get("playerId") as string;

  const { error } = await supabase.rpc("move_to_ir", {
    p_league_id: leagueId,
    p_user_id: user.id,
    p_player_id: playerId,
  });

  if (error) {
    redirect(
      `/dashboard/league/${leagueId}/roster?error=` +
        encodeURIComponent(error.message)
    );
  }

  rosterPaths(leagueId).forEach((p) => revalidatePath(p));
  redirect(`/dashboard/league/${leagueId}/roster?ir=1`);
}

export async function moveFromIR(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const leagueId = formData.get("leagueId") as string;
  const playerId = formData.get("playerId") as string;

  const { error } = await supabase.rpc("move_from_ir", {
    p_league_id: leagueId,
    p_user_id: user.id,
    p_player_id: playerId,
  });

  if (error) {
    redirect(
      `/dashboard/league/${leagueId}/roster?error=` +
        encodeURIComponent(error.message)
    );
  }

  rosterPaths(leagueId).forEach((p) => revalidatePath(p));
  redirect(`/dashboard/league/${leagueId}/roster`);
}

export async function useRestoreChip(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const leagueId = formData.get("leagueId") as string;
  const chipId   = formData.get("chipId")   as string;
  const playerId = formData.get("playerId") as string;

  if (!leagueId || !chipId || !playerId) {
    redirect(`/dashboard/league/${leagueId}/roster?error=` + encodeURIComponent("Missing required fields."));
  }

  // Verify chip belongs to this user and is unused
  const { data: member } = await supabase
    .from("league_members")
    .select("id")
    .eq("league_id", leagueId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!member) redirect("/dashboard?error=" + encodeURIComponent("Not a member of this league."));

  const { data: chip } = await supabase
    .from("power_restore_chips")
    .select("id, used")
    .eq("id", chipId)
    .eq("member_id", member.id)
    .maybeSingle();

  if (!chip) {
    redirect(`/dashboard/league/${leagueId}/roster?error=` + encodeURIComponent("Restore chip not found."));
  }
  if (chip.used) {
    redirect(`/dashboard/league/${leagueId}/roster?error=` + encodeURIComponent("That chip has already been used."));
  }

  // Set restored_at on the negated player's power row
  const { error: restoreError } = await supabase
    .from("player_draft_powers")
    .update({ restored_at: new Date().toISOString() })
    .eq("league_id", leagueId)
    .eq("player_id", playerId)
    .eq("power", "power_negation")
    .is("restored_at", null);

  if (restoreError) {
    redirect(`/dashboard/league/${leagueId}/roster?error=` + encodeURIComponent(restoreError.message));
  }

  // Mark chip as used
  await supabase
    .from("power_restore_chips")
    .update({ used: true, used_at: new Date().toISOString(), used_on_player_id: playerId })
    .eq("id", chipId);

  rosterPaths(leagueId).forEach((p) => revalidatePath(p));
  redirect(`/dashboard/league/${leagueId}/roster?restored=1`);
}

export async function toggleTradeBlock(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const leagueId = formData.get("leagueId") as string;
  const playerId = formData.get("playerId") as string;
  const block    = formData.get("block") === "true"; // desired new state

  const { data: member } = await supabase
    .from("league_members")
    .select("id")
    .eq("league_id", leagueId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!member) redirect("/dashboard");

  await supabase
    .from("uff_roster_players")
    .update({ on_trade_block: block })
    .eq("member_id", member.id)
    .eq("player_id", playerId)
    .is("dropped_at", null);

  revalidatePath(`/dashboard/league/${leagueId}/roster`);
  revalidatePath(`/dashboard/league/${leagueId}/trade-block`);
  redirect(`/dashboard/league/${leagueId}/roster?block=${block ? "added" : "removed"}`);
}

export async function addAndDropPlayer(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const leagueId    = formData.get("leagueId")    as string;
  const addPlayerId = formData.get("addPlayerId")  as string;
  const dropPlayerId = formData.get("dropPlayerId") as string;

  if (!dropPlayerId) {
    redirect(`/dashboard/league/${leagueId}/free-agents?error=${encodeURIComponent("Select a player to drop.")}`);
  }

  const { error } = await supabase.rpc("add_and_drop_player", {
    p_league_id:      leagueId,
    p_user_id:        user.id,
    p_add_player_id:  addPlayerId,
    p_drop_player_id: dropPlayerId,
  });

  if (error) {
    redirect(`/dashboard/league/${leagueId}/free-agents?error=${encodeURIComponent(error.message)}`);
  }

  rosterPaths(leagueId).forEach((p) => revalidatePath(p));
  redirect(`/dashboard/league/${leagueId}/free-agents?added=1&dropped=1`);
}
