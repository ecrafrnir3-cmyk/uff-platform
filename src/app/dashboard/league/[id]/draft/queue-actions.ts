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

  return {
    player: {
      id: targetId,
      full_name: playerInfo?.full_name ?? targetId,
      position: playerInfo?.position ?? null,
    },
  };
}
