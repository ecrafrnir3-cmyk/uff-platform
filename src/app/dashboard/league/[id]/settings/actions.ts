"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function saveScoringSettings(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const leagueId = formData.get("leagueId") as string;

  // Build settings object from form — every key is a stat key with a numeric value
  const settings: Record<string, number> = {};
  for (const [key, value] of formData.entries()) {
    if (key === "leagueId") continue;
    const num = parseFloat(value as string);
    if (!isNaN(num)) settings[key] = num;
  }

  const { error } = await supabase.rpc("update_scoring_settings", {
    p_league_id: leagueId,
    p_user_id: user.id,
    p_settings: settings,
  });

  if (error) {
    redirect(`/dashboard/league/${leagueId}/settings?error=` + encodeURIComponent(error.message));
  }

  revalidatePath(`/dashboard/league/${leagueId}/settings`);
  redirect(`/dashboard/league/${leagueId}/settings?saved=1`);
}

export async function generateSchedule(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const leagueId = formData.get("leagueId") as string;

  const { error } = await supabase.rpc("generate_schedule", {
    p_league_id: leagueId,
    p_user_id: user.id,
  });

  if (error) {
    redirect(`/dashboard/league/${leagueId}/settings?error=` + encodeURIComponent(error.message));
  }

  revalidatePath(`/dashboard/league/${leagueId}`);
  redirect(`/dashboard/league/${leagueId}/settings?saved=1`);
}
