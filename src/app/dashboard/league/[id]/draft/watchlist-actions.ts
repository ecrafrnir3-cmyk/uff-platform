"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export async function addToWatchlist(memberId: string, playerId: string, leagueId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  // Verify ownership
  const { data: member } = await supabase
    .from("league_members")
    .select("id")
    .eq("id", memberId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!member) return { error: "Not authorized" };

  const { error } = await supabase
    .from("uff_watchlist")
    .upsert({ member_id: memberId, player_id: playerId }, { onConflict: "member_id,player_id" });

  if (error) return { error: error.message };
  revalidatePath(`/dashboard/league/${leagueId}/draft`);
  return { ok: true };
}

export async function removeFromWatchlist(memberId: string, playerId: string, leagueId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const { data: member } = await supabase
    .from("league_members")
    .select("id")
    .eq("id", memberId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!member) return { error: "Not authorized" };

  const { error } = await supabase
    .from("uff_watchlist")
    .delete()
    .eq("member_id", memberId)
    .eq("player_id", playerId);

  if (error) return { error: error.message };
  revalidatePath(`/dashboard/league/${leagueId}/draft`);
  return { ok: true };
}
