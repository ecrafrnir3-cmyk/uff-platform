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

export async function extendSchedule(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const leagueId  = formData.get("leagueId") as string;
  const newWeeks  = parseInt(formData.get("new_weeks") as string, 10);

  if (isNaN(newWeeks) || newWeeks < 1 || newWeeks > 18) {
    redirect(`/dashboard/league/${leagueId}/settings?error=${encodeURIComponent("Invalid week count (must be 1–18).")}`);
  }

  const { error } = await supabase.rpc("extend_schedule", {
    p_league_id: leagueId,
    p_user_id:   user.id,
    p_new_weeks: newWeeks,
  });

  if (error) {
    redirect(`/dashboard/league/${leagueId}/settings?error=` + encodeURIComponent(error.message));
  }

  revalidatePath(`/dashboard/league/${leagueId}/matchups`);
  redirect(`/dashboard/league/${leagueId}/settings?saved=1`);
}

export async function saveLeagueSettings(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const leagueId           = formData.get("leagueId") as string;
  const playoffTeams       = parseInt(formData.get("playoff_teams") as string, 10);
  const playoffStartWeek   = parseInt(formData.get("playoff_start_week") as string, 10);
  const championshipWeek   = parseInt(formData.get("championship_week") as string, 10);
  const medianScoring      = formData.get("median_scoring") === "1";
  const tradeDeadlineRaw   = formData.get("trade_deadline_week") as string;
  const tradeDeadlineWeek  = tradeDeadlineRaw ? parseInt(tradeDeadlineRaw, 10) : null;
  const faabBudgetRaw       = formData.get("faab_budget") as string;
  const faabBudget          = faabBudgetRaw ? Math.max(0, parseInt(faabBudgetRaw, 10)) : 0;
  const commissionerReview  = formData.get("commissioner_review") === "1";
  const maxAddsPerWeekRaw   = formData.get("max_adds_per_week") as string;
  const maxAddsPerSeasonRaw = formData.get("max_adds_per_season") as string;
  const maxAddsPerWeek      = maxAddsPerWeekRaw ? Math.max(0, parseInt(maxAddsPerWeekRaw, 10)) : 0;
  const maxAddsPerSeason    = maxAddsPerSeasonRaw ? Math.max(0, parseInt(maxAddsPerSeasonRaw, 10)) : 0;
  const waiverAuto          = formData.get("waiver_auto") === "1";
  const waiverDay           = parseInt((formData.get("waiver_day")  as string) ?? "3", 10);
  const waiverHour          = parseInt((formData.get("waiver_hour") as string) ?? "3", 10);
  const waiverTypeRaw       = formData.get("waiver_type") as string;
  const waiverType          = waiverTypeRaw === "priority" ? "priority" : "faab";

  const { error } = await supabase
    .from("uff_leagues")
    .update({
      playoff_teams:        playoffTeams,
      playoff_start_week:   playoffStartWeek,
      championship_week:    championshipWeek,
      median_scoring:       medianScoring,
      trade_deadline_week:  tradeDeadlineWeek,
      faab_budget:          faabBudget,
      commissioner_review:  commissionerReview,
      max_adds_per_week:    maxAddsPerWeek,
      max_adds_per_season:  maxAddsPerSeason,
      waiver_auto:          waiverAuto,
      waiver_day:           isNaN(waiverDay)  ? 3 : Math.min(6, Math.max(0, waiverDay)),
      waiver_hour:          isNaN(waiverHour) ? 3 : Math.min(23, Math.max(0, waiverHour)),
      waiver_type:          waiverType,
    })
    .eq("id", leagueId)
    .eq("commissioner_id", user.id);

  if (error) {
    redirect(`/dashboard/league/${leagueId}/settings?error=` + encodeURIComponent(error.message));
  }

  // If FAAB is enabled, initialize balances for any members who don't have one yet
  if (faabBudget > 0) {
    await supabase
      .from("league_members")
      .update({ faab_balance: faabBudget })
      .eq("league_id", leagueId)
      .is("faab_balance", null);
  }

  revalidatePath(`/dashboard/league/${leagueId}/settings`);
  redirect(`/dashboard/league/${leagueId}/settings?saved=1`);
}

export async function processWaivers(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const leagueId   = formData.get("leagueId") as string;
  const week       = parseInt(formData.get("week") as string, 10);
  const waiverType = formData.get("waiver_type") as string;

  if (isNaN(week) || week < 1 || week > 18) {
    redirect(`/dashboard/league/${leagueId}/settings?error=${encodeURIComponent("Invalid week.")}`);
  }

  const isPriority = waiverType === "priority";
  const { data, error } = isPriority
    ? await supabase.rpc("process_priority_waivers", { p_league_id: leagueId, p_week: week })
    : await supabase.rpc("process_waiver_bids", { p_league_id: leagueId, p_user_id: user.id, p_week: week });

  if (error) {
    redirect(`/dashboard/league/${leagueId}/settings?error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath(`/dashboard/league/${leagueId}/free-agents`);
  revalidatePath(`/dashboard/league/${leagueId}/roster`);
  redirect(`/dashboard/league/${leagueId}/settings?saved=1&claims=${data ?? 0}`);
}

export async function resetWaiverPriority(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const leagueId = formData.get("leagueId") as string;
  const season   = parseInt(formData.get("season") as string, 10);

  // Verify commissioner
  const { data: league } = await supabase
    .from("uff_leagues")
    .select("commissioner_id")
    .eq("id", leagueId)
    .maybeSingle();
  if (league?.commissioner_id !== user.id) {
    redirect(`/dashboard/league/${leagueId}/settings?error=` + encodeURIComponent("Not authorized."));
  }

  const { error } = await supabase.rpc("reset_waiver_priority", {
    p_league_id: leagueId,
    p_season:    season,
  });

  if (error) {
    redirect(`/dashboard/league/${leagueId}/settings?error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath(`/dashboard/league/${leagueId}/settings`);
  revalidatePath(`/dashboard/league/${leagueId}/free-agents`);
  redirect(`/dashboard/league/${leagueId}/settings?saved=1`);
}

export async function seedPlayoffs(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const leagueId = formData.get("leagueId") as string;

  const { error } = await supabase.rpc("seed_playoffs", {
    p_league_id: leagueId,
    p_user_id:   user.id,
  });

  if (error) {
    redirect(`/dashboard/league/${leagueId}/settings?error=` + encodeURIComponent(error.message));
  }

  revalidatePath(`/dashboard/league/${leagueId}/playoffs`);
  redirect(`/dashboard/league/${leagueId}/playoffs`);
}

export async function addToCantCutList(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const leagueId = formData.get("leagueId") as string;
  const playerId  = formData.get("playerId")  as string;

  if (!playerId) {
    redirect(`/dashboard/league/${leagueId}/settings?error=${encodeURIComponent("No player selected.")}`);
  }

  const { error } = await supabase.rpc("add_to_cant_cut", {
    p_league_id: leagueId,
    p_user_id:   user.id,
    p_player_id: playerId,
  });

  if (error) {
    redirect(`/dashboard/league/${leagueId}/settings?error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath(`/dashboard/league/${leagueId}/settings`);
  redirect(`/dashboard/league/${leagueId}/settings?saved=1#cant-cut`);
}

export async function removeFromCantCutList(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const leagueId = formData.get("leagueId") as string;
  const playerId  = formData.get("playerId")  as string;

  const { error } = await supabase.rpc("remove_from_cant_cut", {
    p_league_id: leagueId,
    p_user_id:   user.id,
    p_player_id: playerId,
  });

  if (error) {
    redirect(`/dashboard/league/${leagueId}/settings?error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath(`/dashboard/league/${leagueId}/settings`);
  redirect(`/dashboard/league/${leagueId}/settings?saved=1#cant-cut`);
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
