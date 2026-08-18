"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { notifyNextPicker } from "@/lib/draft-notify";

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
  "Shadow Guard": "shadow_guard",
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

  // ── Non-blocking: notify the next picker ──────────────────────────────────
  await notifyNextPicker(supabase, leagueId);

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

  // Power name/category/position from the client are display hints only — every
  // authorization-relevant value is re-derived server-side below (audit U5:
  // the old version trusted them, letting any member overwrite any player's
  // power, e.g. strip an opponent's Shadow Guard before a Vampire Bite).
  const { leagueId, playerId, round } = params;

  const { data: member } = await supabase
    .from("league_members")
    .select("id")
    .eq("league_id", leagueId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!member) return { result: "error", message: "Not a member of this league." };

  // The caller must have actually drafted this player in this round
  const { data: pick } = await supabase
    .from("uff_draft_picks")
    .select("id")
    .eq("league_id", leagueId)
    .eq("player_id", playerId)
    .eq("member_id", member.id)
    .eq("round", round)
    .maybeSingle();
  if (!pick) return { result: "error", message: "You didn't draft that player in this round." };

  // The power comes from the caller's own dealt assignment for this round
  const { data: assignment } = await supabase
    .from("draft_power_assignments")
    .select("power_id, draft_powers(name, category, tied_position)")
    .eq("league_id", leagueId)
    .eq("member_id", member.id)
    .eq("round", round)
    .maybeSingle();
  const power = (assignment?.draft_powers as unknown as { name: string; category: string; tied_position: string | null } | null);
  if (!power) return { result: "error", message: "No power assignment found for this round." };

  const powerName = power.name;
  const powerTiedPosition = power.tied_position;

  // Draft mechanics are resolved during the draft flow itself, not tied to the player pick
  if (power.category === "draft_mechanic") {
    return { result: "meta", message: `${powerName} is a draft mechanic — it was applied automatically during your pick.` };
  }

  // Vampire Bite targets another player — handled via separate modal
  if (powerName === "Vampire Bite") {
    return { result: "vampire_bite", message: "Select your Vampire Bite target." };
  }

  // Player position from the DB, not the client
  const { data: playerRow } = await supabase
    .from("players")
    .select("position")
    .eq("id", playerId)
    .maybeSingle();
  const playerPosition = playerRow?.position ?? "";

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

  // Never overwrite a power another manager attached to their own pick
  const { data: existing } = await supabase
    .from("player_draft_powers")
    .select("drafted_by_user_id")
    .eq("league_id", leagueId)
    .eq("player_id", playerId)
    .maybeSingle();
  if (existing && existing.drafted_by_user_id !== user.id) {
    return { result: "error", message: "That player already carries another manager's power." };
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

  // Atomic RPC: verifies membership, that the caller actually holds Foresight
  // Coin in currentRound, and that swapWithRound is a future round — then swaps
  // both rows in one transaction (the old two-UPDATE version could duplicate a
  // power if the second write failed, and never checked coin ownership).
  const { error } = await supabase.rpc("swap_foresight_powers", {
    p_league_id: leagueId,
    p_current_round: currentRound,
    p_swap_round: swapWithRound,
  });
  if (error) return { error: error.message };

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

  // The caller must actually hold Vampire Bite (power_id 16) in this round —
  // previously any member could bite at any time (audit U5)
  const { data: vbAssignment } = await supabase
    .from("draft_power_assignments")
    .select("id")
    .eq("league_id", leagueId)
    .eq("member_id", member.id)
    .eq("round", round)
    .eq("power_id", 16)
    .maybeSingle();
  if (!vbAssignment) {
    return { error: "You don't hold Vampire Bite this round." };
  }

  // Biting your own player is a no-op that wastes the power — block it
  const { data: ownCheck } = await supabase
    .from("uff_roster_players")
    .select("id")
    .eq("league_id", leagueId)
    .eq("player_id", targetPlayerId)
    .eq("member_id", member.id)
    .is("dropped_at", null)
    .maybeSingle();
  if (ownCheck) {
    return { error: "You can't bite your own player — choose an opponent's player." };
  }

  // Shadow Guard check — reject bite if target player is protected
  const { data: guardCheck } = await supabase
    .from("player_draft_powers")
    .select("player_id")
    .eq("league_id", leagueId)
    .eq("player_id", targetPlayerId)
    .eq("power", "shadow_guard")
    .maybeSingle();

  if (guardCheck) {
    return { error: "That player is protected by Shadow Guard — the bite fizzles. Choose a different target." };
  }

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
// this round (unless they have Shadow Guard, which blocks the reveal).
export async function revealNextPower(params: {
  leagueId: string;
  nextMemberId: string;
  currentRound: number;
}): Promise<{ powerName: string | null; cloaked: boolean; error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { powerName: null, cloaked: false, error: "Not authenticated." };

  const { leagueId, nextMemberId, currentRound } = params;

  // Caller must be a league member who actually holds Telepathy (power_id 8)
  // this round — previously ANY authenticated user could reveal any manager's
  // power in any league (audit U5)
  const { data: caller } = await supabase
    .from("league_members")
    .select("id")
    .eq("league_id", leagueId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!caller) return { powerName: null, cloaked: false, error: "Not a member of this league." };

  const { data: telepathyCheck } = await supabase
    .from("draft_power_assignments")
    .select("id")
    .eq("league_id", leagueId)
    .eq("member_id", caller.id)
    .eq("round", currentRound)
    .eq("power_id", 8) // Telepathy
    .maybeSingle();
  if (!telepathyCheck) return { powerName: null, cloaked: false, error: "You don't hold Telepathy this round." };

  // Check if next manager has Shadow Guard (power_id = 9) for this round — blocks Telepathy reveal
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

  const { leagueId, targetMemberId, currentRound, currentDraftOrder } = params;

  // Identity comes from the session, never from the client (audit U5). The
  // update_draft_heist_order RPC additionally verifies the caller holds Draft
  // Heist this round, no heist is already active, and the new order is a
  // permutation of the current one.
  const { data: me } = await supabase
    .from("league_members")
    .select("id")
    .eq("league_id", leagueId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!me) return { blocked: false, error: "Not a member of this league." };
  const myMemberId = me.id;

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
