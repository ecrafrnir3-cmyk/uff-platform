"use server";

import { createClient } from "@/lib/supabase/server";

export async function submitWaiverBid(
  formData: FormData
): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const leagueId      = formData.get("leagueId") as string;
  const playerId      = formData.get("playerId") as string;
  const bidAmount     = parseInt(formData.get("bidAmount") as string, 10);
  const dropPlayerRaw = formData.get("dropPlayerId") as string;
  const dropPlayerId  = dropPlayerRaw?.trim() || null;
  const week          = parseInt(formData.get("week") as string, 10);

  if (!leagueId || !playerId) return { error: "Missing required fields" };
  if (isNaN(bidAmount) || bidAmount < 0) return { error: "Invalid bid amount" };

  const { error } = await supabase.rpc("submit_waiver_bid", {
    p_league_id:      leagueId,
    p_player_id:      playerId,
    p_drop_player_id: dropPlayerId,
    p_bid_amount:     bidAmount,
    p_week:           week,
  });

  if (error) return { error: error.message };
  return {};
}

export async function cancelWaiverBid(
  formData: FormData
): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const bidId = formData.get("bidId") as string;
  if (!bidId) return { error: "No bid ID" };

  const { error } = await supabase.rpc("cancel_waiver_bid", {
    p_bid_id: bidId,
  });

  if (error) return { error: error.message };
  return {};
}
