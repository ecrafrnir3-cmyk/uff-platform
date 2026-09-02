"use server";

import { createClient } from "@/lib/supabase/server";
import { notifyNextPicker } from "@/lib/draft-notify";

async function getMemberId(leagueId: string): Promise<{ memberId: string | null; error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { memberId: null, error: "Not authenticated." };

  const { data: member } = await supabase
    .from("league_members")
    .select("id")
    .eq("league_id", leagueId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!member) return { memberId: null, error: "Not a member of this league." };
  return { memberId: member.id };
}

export async function addToQueue(
  leagueId: string,
  playerId: string,
): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { memberId, error: memberErr } = await getMemberId(leagueId);
  if (!memberId) return { error: memberErr };

  // Get current max position
  const { data: last } = await supabase
    .from("draft_queue")
    .select("position")
    .eq("member_id", memberId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();

  const nextPos = (last?.position ?? -1) + 1;

  const { error } = await supabase.from("draft_queue").insert({
    league_id: leagueId,
    member_id: memberId,
    player_id: playerId,
    position: nextPos,
  });

  if (error) {
    if (error.code === "23505") return {}; // already in queue — ignore
    return { error: error.message };
  }

  return {};
}

export async function removeFromQueue(
  leagueId: string,
  playerId: string,
): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { memberId, error: memberErr } = await getMemberId(leagueId);
  if (!memberId) return { error: memberErr };

  const { error } = await supabase
    .from("draft_queue")
    .delete()
    .eq("member_id", memberId)
    .eq("player_id", playerId);

  if (error) return { error: error.message };
  return {};
}

export async function saveQueueOrder(
  leagueId: string,
  playerIds: string[],
): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { memberId, error: memberErr } = await getMemberId(leagueId);
  if (!memberId) return { error: memberErr };

  await Promise.all(
    playerIds.map((pid, idx) =>
      supabase
        .from("draft_queue")
        .update({ position: idx })
        .eq("member_id", memberId)
        .eq("player_id", pid),
    ),
  );

  return {};
}

export async function executeAutodraft(leagueId: string): Promise<{
  error?: string;
  player?: { id: string; full_name: string; position: string | null };
}> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };

  const { memberId, error: memberErr } = await getMemberId(leagueId);
  if (!memberId) return { error: memberErr };

  // All picked player IDs in this league
  const { data: picks } = await supabase
    .from("uff_draft_picks")
    .select("player_id")
    .eq("league_id", leagueId);

  const pickedIds = new Set((picks ?? []).map((p) => p.player_id));

  // Preferred: top available player from the user's queue
  const { data: queueItems } = await supabase
    .from("draft_queue")
    .select("player_id, players(full_name, position)")
    .eq("member_id", memberId)
    .eq("league_id", leagueId)
    .order("position", { ascending: true });

  let targetId: string | null = null;
  let playerInfo: { full_name: string; position: string | null } | null = null;

  const top = (queueItems ?? []).find((q) => !pickedIds.has(q.player_id));
  if (top) {
    targetId = top.player_id;
    playerInfo = top.players as unknown as { full_name: string; position: string | null } | null;
  } else {
    // Queue empty or exhausted — fall back to best available player by ADP so
    // an expired pick clock always produces a pick instead of stalling the
    // draft on "your queue is empty" (audit U6).
    const { data: best } = await supabase
      .from("players")
      .select("id, full_name, position, adp")
      .not("adp", "is", null)
      .order("adp", { ascending: true })
      .limit(400);
    const avail = (best ?? []).find((p) => !pickedIds.has(p.id));
    if (avail) {
      targetId = avail.id;
      playerInfo = { full_name: avail.full_name, position: avail.position };
    }
  }

  if (!targetId) {
    return { error: "No available ranked players found to autopick." };
  }

  // Make the pick (same RPC as makeDraftPick — it validates turn + duplicates)
  const { error: pickErr } = await supabase.rpc("make_draft_pick", {
    p_league_id: leagueId,
    p_user_id: user.id,
    p_player_id: targetId,
  });

  if (pickErr) return { error: pickErr.message };

  // Remove from queue (no-op for best-available fallback picks)
  await supabase
    .from("draft_queue")
    .delete()
    .eq("member_id", memberId)
    .eq("player_id", targetId);

  await notifyNextPicker(supabase, leagueId);

  return {
    player: {
      id: targetId,
      full_name: playerInfo?.full_name ?? targetId,
      position: playerInfo?.position ?? null,
    },
  };
}

// ── Force-autopick: any league member can invoke this once the on-the-clock
// member's pick clock has expired (server-validated). This is the safety net
// for the offline-picker freeze (audit U6): the clock no longer depends on the
// on-the-clock user's browser being open. The force_autopick RPC re-validates
// the deadline server-side from the last pick's picked_at, so early or
// duplicate calls are harmless no-ops.
export async function forceAutopick(leagueId: string): Promise<{
  error?: string;
  picked?: boolean;
}> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };

  const { memberId, error: memberErr } = await getMemberId(leagueId);
  if (!memberId) return { error: memberErr };

  const { data, error } = await supabase.rpc("force_autopick", {
    p_league_id: leagueId,
  });

  if (error) {
    // "clock not expired" / "not drafting" / lost race — all expected no-ops
    return { error: error.message };
  }

  if (data) await notifyNextPicker(supabase, leagueId);
  return { picked: !!data };
}

// ── Commissioner proxy pick: the commissioner drafts a specific player FOR the
// manager currently on the clock (for a no-show who can't attend the draft). The
// RPC re-checks commissioner identity + that the target is actually on the clock
// server-side, so this cannot jump the draft order or be called by a non-commish.
export async function commissionerPick(
  leagueId: string,
  targetMemberId: string,
  playerId: string,
): Promise<{ error?: string; picked?: boolean }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };

  const { data, error } = await supabase.rpc("commissioner_draft_pick", {
    p_league_id: leagueId,
    p_target_member_id: targetMemberId,
    p_player_id: playerId,
  });

  if (error) return { error: error.message };

  await notifyNextPicker(supabase, leagueId);
  return { picked: !!data };
}

// ── Commissioner proxy — interactive powers ────────────────────────────────────
// When the commissioner drafts for a no-show, the no-show's INTERACTIVE powers
// (Vampire Bite / Foresight Coin / Draft Heist) can't auto-attach — they need a
// choice. These let the commissioner make that choice AS the on-clock team. Each
// RPC re-checks commissioner identity + that the acting member actually holds the
// power this round, server-side, so none of this can be driven by a non-commish.

type ProxyPowerRow = {
  round: number;
  draft_powers: {
    id: number;
    name: string;
    category: string | null;
    description: string;
    tied_position: string | null;
  } | null;
};

// The on-clock member's power rows for the whole draft, so the commissioner UI
// can tell which interactive power (if any) that team holds this round and drive
// the right modal. Gated to the league commissioner.
export async function getMemberPowers(
  leagueId: string,
  memberId: string,
): Promise<{ error?: string; powers?: ProxyPowerRow[] }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };

  const { data: league } = await supabase
    .from("uff_leagues")
    .select("commissioner_id")
    .eq("id", leagueId)
    .maybeSingle();
  if (!league || league.commissioner_id !== user.id) {
    return { error: "Only the commissioner can view another manager's powers." };
  }

  const { data } = await supabase
    .from("draft_power_assignments")
    .select("round, draft_powers(id, name, category, description, tied_position)")
    .eq("league_id", leagueId)
    .eq("member_id", memberId)
    .order("round", { ascending: true });

  return { powers: (data ?? []) as unknown as ProxyPowerRow[] };
}

export async function commissionerVampireBite(
  leagueId: string,
  actingMemberId: string,
  targetPlayerId: string,
  round: number,
): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };

  const { error } = await supabase.rpc("commissioner_vampire_bite", {
    p_league_id: leagueId,
    p_acting_member_id: actingMemberId,
    p_target_player_id: targetPlayerId,
    p_round: round,
  });
  if (error) return { error: error.message };
  return {};
}

export async function commissionerForesightSwap(
  leagueId: string,
  actingMemberId: string,
  currentRound: number,
  swapRound: number,
): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };

  const { error } = await supabase.rpc("commissioner_foresight_swap", {
    p_league_id: leagueId,
    p_acting_member_id: actingMemberId,
    p_current_round: currentRound,
    p_swap_round: swapRound,
  });
  if (error) return { error: error.message };
  return {};
}

export async function commissionerHeist(
  leagueId: string,
  actingMemberId: string,
  targetMemberId: string,
): Promise<{ error?: string; blocked?: boolean; blockerTeam?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };

  const { data, error } = await supabase.rpc("commissioner_heist", {
    p_league_id: leagueId,
    p_acting_member_id: actingMemberId,
    p_target_member_id: targetMemberId,
  });
  if (error) return { error: error.message };
  const res = data as { blocked: boolean; blockerTeam?: string } | null;
  return { blocked: res?.blocked ?? false, blockerTeam: res?.blockerTeam };
}
