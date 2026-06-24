"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

const POWER_SLUG_MAP: Record<string, string> = {
  "Gunslinger": "gunslinger",
  "Berserker Rage": "berserker_rage",
  "Reception Specialist": "reception_specialist",
  "Iron Defense": "iron_defense",
  "Red Zone Menace": "red_zone_menace",
  "Goal Line Hammer": "goal_line_hammer",
  "Seam Buster": "seam_buster",
  "Sniper": "sniper",
  "Power Negation": "power_negation",
  "Time Stone": "time_stone",
  "Vampire Bite": "vampire_bite",
  "Foresight Coin": "foresight_coin",
  "Draft Heist": "draft_heist",
  "Hero's Shield": "hero_shield",
  "Telepathy": "telepathy",
  "Cloak": "cloak",
};

export async function makeDraftPick(formData: FormData): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };

  const leagueId = formData.get("leagueId") as string;
  const playerId = formData.get("playerId") as string;
  if (!leagueId || !playerId) return { error: "Missing league or player." };

  const { error } = await supabase.rpc("make_draft_pick", {
    p_league_id: leagueId,
    p_user_id: user.id,
    p_player_id: playerId,
  });

  if (error) return { error: error.message };

  revalidatePath(`/dashboard/league/${leagueId}/draft`);
  revalidatePath(`/dashboard/league/${leagueId}/roster`);
  return {};
}

export async function assignPowerToPick(params: {
  leagueId: string;
  playerId: string;
  playerPosition: string;
  powerName: string;
  powerCategory: string;
  powerTiedPosition: string | null;
  round: number;
}): Promise<{ result: "applied" | "fizzled" | "meta" | "vampire_bite" | "error"; message: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { result: "error", message: "Not authenticated." };

  const { leagueId, playerId, playerPosition, powerName, powerCategory, powerTiedPosition, round } = params;

  // Draft mechanics are resolved during the draft flow itself, not tied to the player pick
  if (powerCategory === "draft_mechanic") {
    return { result: "meta", message: `${powerName} is a draft mechanic — it was applied automatically during your pick.` };
  }

  // Vampire Bite targets another player — handled via separate modal
  if (powerName === "Vampire Bite") {
    return { result: "vampire_bite", message: "Select your Vampire Bite target." };
  }

  // Check position eligibility
  let eligible = false;
  if (!powerTiedPosition || powerTiedPosition === "ANY") {
    eligible = true;
  } else if (powerTiedPosition === "WR/RB/TE") {
    eligible = ["WR", "RB", "TE"].includes(playerPosition);
  } else if (powerTiedPosition === "D/ST") {
    eligible = playerPosition === "DEF";
  } else {
    eligible = playerPosition === powerTiedPosition;
  }

  if (!eligible) {
    return {
      result: "fizzled",
      message: `${powerName} fizzled — ${playerPosition || "this position"} doesn't match the required position.`,
    };
  }

  const slug = POWER_SLUG_MAP[powerName] ?? powerName.toLowerCase().replace(/[^a-z0-9]/g, "_");

  const { error } = await supabase.from("player_draft_powers").upsert(
    {
      league_id: leagueId,
      player_id: playerId,
      power: slug,
      round,
      drafted_by_user_id: user.id,
    },
    { onConflict: "league_id,player_id" }
  );

  if (error) return { result: "error", message: error.message };

  return { result: "applied", message: `${powerName} attached to this pick — active for the season!` };
}

export async function swapForesightCoin(params: {
  leagueId: string;
  currentRound: number;
  swapWithRound: number;
}): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };

  const { leagueId, currentRound, swapWithRound } = params;

  const { data: member } = await supabase
    .from("league_members")
    .select("id")
    .eq("league_id", leagueId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!member) return { error: "Not a member of this league." };

  const { data: assignments } = await supabase
    .from("draft_power_assignments")
    .select("id, round, power_id")
    .eq("member_id", member.id)
    .in("round", [currentRound, swapWithRound]);

  if (!assignments || assignments.length < 2) return { error: "Could not find power assignments to swap." };

  const curr = assignments.find((a) => a.round === currentRound);
  const swap = assignments.find((a) => a.round === swapWithRound);
  if (!curr || !swap) return { error: "Could not find power assignments to swap." };

  // Swap power_ids between the two rows
  const [e1, e2] = await Promise.all([
    supabase.from("draft_power_assignments").update({ power_id: swap.power_id }).eq("id", curr.id),
    supabase.from("draft_power_assignments").update({ power_id: curr.power_id }).eq("id", swap.id),
  ]);
  if (e1.error) return { error: e1.error.message };
  if (e2.error) return { error: e2.error.message };

  revalidatePath(`/dashboard/league/${leagueId}/draft`);
  return {};
}

export async function assignVampireBite(params: {
  leagueId: string;
  targetPlayerId: string;
  round: number;
}): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };

  const { leagueId, targetPlayerId, round } = params;

  const { data: member } = await supabase
    .from("league_members")
    .select("id")
    .eq("league_id", leagueId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!member) return { error: "Not a member of this league." };

  const { error } = await supabase.from("vampire_bites").insert({
    league_id: leagueId,
    biting_member_id: member.id,
    target_player_id: targetPlayerId,
    round,
  });

  if (error) {
    if (error.code === "23505") {
      return { error: "That player has already been bitten. Choose someone else." };
    }
    return { error: error.message };
  }

  revalidatePath(`/dashboard/league/${leagueId}/draft`);
  return {};
}

// ── Draft Mechanic: Telepathy ─────────────────────────────────────────────────
// Called after a Telepathy holder picks. Reveals the next manager's power for
// this round (unless they have Cloak, which blocks the reveal).
export async function revealNextPower(params: {
  leagueId: string;
  nextMemberId: string;
  currentRound: number;
}): Promise<{ powerName: string | null; cloaked: boolean; error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { powerName: null, cloaked: false, error: "Not authenticated." };

  const { leagueId, nextMemberId, currentRound } = params;

  // Check if next manager has Cloak (power_id = 9) for this round
  const { data: cloakCheck } = await supabase
    .from("draft_power_assignments")
    .select("power_id")
    .eq("league_id", leagueId)
    .eq("member_id", nextMemberId)
    .eq("round", currentRound)
    .eq("power_id", 9) // Cloak
    .maybeSingle();

  if (cloakCheck) return { powerName: null, cloaked: true };

  // Fetch next manager's power for this round
  const { data: assignment } = await supabase
    .from("draft_power_assignments")
    .select("draft_powers(name)")
    .eq("league_id", leagueId)
    .eq("member_id", nextMemberId)
    .eq("round", currentRound)
    .maybeSingle();

  const powerName = (assignment?.draft_powers as unknown as { name: string } | null)?.name ?? null;
  return { powerName, cloaked: false };
}

// ── Draft Mechanic: Draft Heist ───────────────────────────────────────────────
// Fired BEFORE the heist holder picks. Swaps their draft_order position with
// the target's for this round. Saves original order for restoration later.
// Blocked if the target has Hero's Shield (power_id = 4) this round.
export async function executeHeist(params: {
  leagueId: string;
  targetMemberId: string;
  currentRound: number;
  currentDraftOrder: string[];
  myMemberId: string;
}): Promise<{ blocked: boolean; blockerTeam?: string; error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { blocked: false, error: "Not authenticated." };

  const { leagueId, targetMemberId, currentRound, currentDraftOrder, myMemberId } = params;

  // Check if target has Hero's Shield this round
  const { data: shieldCheck } = await supabase
    .from("draft_power_assignments")
    .select("id")
    .eq("league_id", leagueId)
    .eq("member_id", targetMemberId)
    .eq("round", currentRound)
    .eq("power_id", 4) // Hero's Shield
    .maybeSingle();

  if (shieldCheck) {
    const { data: targetMember } = await supabase
      .from("league_members")
      .select("team_name")
      .eq("id", targetMemberId)
      .maybeSingle();
    return { blocked: true, blockerTeam: targetMember?.team_name ?? "that team" };
  }

  // Swap positions in draft_order
  const myIdx = currentDraftOrder.indexOf(myMemberId);
  const targetIdx = currentDraftOrder.indexOf(targetMemberId);
  if (myIdx === -1 || targetIdx === -1) {
    return { blocked: false, error: "Could not find draft positions." };
  }

  const newOrder = [...currentDraftOrder];
  newOrder[myIdx] = targetMemberId;
  newOrder[targetIdx] = myMemberId;

  const heistState = {
    round: currentRound,
    memberA: myMemberId,
    memberB: targetMemberId,
    originalOrder: currentDraftOrder,
  };

  const { error } = await supabase.rpc("update_draft_heist_order", {
    p_league_id:   leagueId,
    p_new_order:   newOrder,
    p_heist_state: heistState,
  });

  if (error) return { blocked: false, error: error.message };

  revalidatePath(`/dashboard/league/${leagueId}/draft`);
  return { blocked: false };
}

// ── Draft Mechanic: Restore Heist Order ──────────────────────────────────────
// Called at the start of a new round (when round > heist_state.round).
// Restores draft_order to the original pre-heist order and clears heist_state.
export async function restoreHeistOrder(params: {
  leagueId: string;
  originalOrder: string[];
}): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };

  const { error } = await supabase.rpc("clear_heist_state", {
    p_league_id:      params.leagueId,
    p_original_order: params.originalOrder,
  });

  if (error) return { error: error.message };
  revalidatePath(`/dashboard/league/${params.leagueId}/draft`);
  return {};
}
