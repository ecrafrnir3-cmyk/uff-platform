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
  const weeks = parseInt(formData.get("season_weeks") as string, 10);

  if (isNaN(weeks) || weeks < 1 || weeks > 18) {
    redirect(`/dashboard/league/${leagueId}/settings?error=${encodeURIComponent("Invalid season length (must be 1–18 weeks).")}`);
  }

  const { error } = await supabase.rpc("generate_schedule", {
    p_league_id: leagueId,
    p_user_id:   user.id,
    p_weeks:     weeks,
  });

  if (error) {
    redirect(`/dashboard/league/${leagueId}/settings?error=` + encodeURIComponent(error.message));
  }

  revalidatePath(`/dashboard/league/${leagueId}`);
  redirect(`/dashboard/league/${leagueId}/settings?saved=1`);
}

export async function forceFinalize(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const leagueId = formData.get("leagueId") as string;
  const week = parseInt(formData.get("week") as string, 10);

  if (isNaN(week) || week < 1 || week > 18) {
    redirect(`/dashboard/league/${leagueId}/settings?error=${encodeURIComponent("Invalid week (must be 1–18).")}`);
  }

  const { error } = await supabase.rpc("finalize_week", {
    p_league_id: leagueId,
    p_user_id:   user.id,
    p_week:      week,
  });

  if (error) {
    redirect(`/dashboard/league/${leagueId}/settings?error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath(`/dashboard/league/${leagueId}/standings`);
  revalidatePath(`/dashboard/league/${leagueId}/matchups`);
  redirect(`/dashboard/league/${leagueId}/settings?saved=1`);
}

export async function syncPlayers(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const leagueId = formData.get("leagueId") as string;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const syncSecret  = process.env.SYNC_SECRET ?? process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !syncSecret) {
    redirect(`/dashboard/league/${leagueId}/settings?error=${encodeURIComponent("Missing server configuration.")}`);
  }

  const res = await fetch(`${supabaseUrl}/functions/v1/sync-players`, {
    method: "POST",
    headers: { Authorization: `Bearer ${syncSecret}` },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: "Sync failed" }));
    redirect(`/dashboard/league/${leagueId}/settings?error=${encodeURIComponent((body as { error?: string }).error ?? "Sync failed.")}`);
  }

  redirect(`/dashboard/league/${leagueId}/settings?saved=1`);
}
