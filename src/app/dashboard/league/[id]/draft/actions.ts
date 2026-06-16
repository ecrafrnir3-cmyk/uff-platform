"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function makeDraftPick(formData: FormData): Promise<{ error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
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
