"use server";

import { createClient } from "@/lib/supabase/server";

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

  // Fetch queue in order
  const { data: queueItems } = await supabase
    .from("draft_queue")
    .select("player_id, players(full_name, position)")
    .eq("member_id", memberId)
    .eq("league_id", leagueId)
    .order("position", { ascending: true });

  if (!queueItems || queueItems.length === 0) {
    return { error: "Your queue is empty. Star some players to queue them." };
  }

  // All picked player IDs in this league
  const { data: picks } = await supabase
    .from("uff_draft_picks")
    .select("player_id")
    .eq("league_id", leagueId);

  const pickedIds = new Set((picks ?? []).map((p) => p.player_id));

  // Top available from queue
  const top = queueItems.find((q) => !pickedIds.has(q.player_id));
  if (!top) {
    return { error: "All queued players have been drafted. Add more players to your queue." };
  }

  const playerInfo = top.players as unknown as { full_name: string; position: string | null } | null;

  // Make the pick (same RPC as makeDraftPick)
  const { error: pickErr } = await supabase.rpc("make_draft_pick", {
    p_league_id: leagueId,
    p_user_id: user.id,
    p_player_id: top.player_id,
  });

  if (pickErr) return { error: pickErr.message };

  // Remove from queue
  await supabase
    .from("draft_queue")
    .delete()
    .eq("member_id", memberId)
    .eq("player_id", top.player_id);

  return {
    player: {
      id: top.player_id,
      full_name: playerInfo?.full_name ?? top.player_id,
      position: playerInfo?.position ?? null,
    },
  };
}
