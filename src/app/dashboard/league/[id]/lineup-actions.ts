"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function setLineup(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const leagueId = formData.get("leagueId") as string;
  const week = parseInt(formData.get("week") as string);

  // Collect non-empty slot assignments from formData
  const slots: { slot: string; player_id: string }[] = [];
  for (const [key, value] of formData.entries()) {
    if (key.startsWith("slot_") && value && value !== "") {
      slots.push({ slot: key.replace("slot_", ""), player_id: value as string });
    }
  }

  if (slots.length === 0) {
    redirect(`/dashboard/league/${leagueId}/roster?error=${encodeURIComponent("No starters selected.")}`);
  }

  const { error } = await supabase.rpc("set_lineup", {
    p_league_id: leagueId,
    p_user_id: user.id,
    p_week: week,
    p_slots: JSON.stringify(slots),
  });

  if (error) {
    redirect(
      `/dashboard/league/${leagueId}/roster?error=${encodeURIComponent(error.message)}`
    );
  }

  revalidatePath(`/dashboard/league/${leagueId}/roster`);
  revalidatePath(`/dashboard/league/${leagueId}/matchups`);
  redirect(`/dashboard/league/${leagueId}/roster?lineup=saved`);
}
