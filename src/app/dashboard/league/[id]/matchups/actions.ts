"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function finalizeWeek(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const leagueId = formData.get("leagueId") as string;
  const week = parseInt(formData.get("week") as string);

  const { error } = await supabase.rpc("finalize_week", {
    p_league_id: leagueId,
    p_user_id: user.id,
    p_week: week,
  });

  if (error) {
    redirect(
      `/dashboard/league/${leagueId}/matchups?week=${week}&error=` +
        encodeURIComponent(error.message)
    );
  }

  // Mark this league's tokens as 'used' now that the week is finalized.
  await supabase.rpc("mark_week_tokens_used", {
    p_league_id: leagueId,
    p_week: week,
  });

  revalidatePath(`/dashboard/league/${leagueId}/matchups`);
  revalidatePath(`/dashboard/league/${leagueId}/standings`);
  redirect(`/dashboard/league/${leagueId}/matchups?week=${week}&saved=1`);
}

/**
 * Commissioner-only: manually adjust a team's score for a given matchup row.
 * delta can be positive or negative (e.g. +5 or -3.5).
 */
export async function adjustScore(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const leagueId     = formData.get("leagueId") as string;
  const matchupRowId = formData.get("matchupRowId") as string;
  const week         = formData.get("week") as string;
  const deltaRaw     = formData.get("delta") as string;
  const delta        = parseFloat(deltaRaw);

  if (isNaN(delta) || delta === 0) {
    redirect(
      `/dashboard/league/${leagueId}/matchups?week=${week}&error=` +
        encodeURIComponent("Enter a non-zero adjustment amount.")
    );
  }

  // Verify commissioner
  const { data: league } = await supabase
    .from("uff_leagues")
    .select("commissioner_id")
    .eq("id", leagueId)
    .maybeSingle();

  if (league?.commissioner_id !== user.id) {
    redirect(
      `/dashboard/league/${leagueId}/matchups?week=${week}&error=` +
        encodeURIComponent("Only the commissioner can adjust scores.")
    );
  }

  // Fetch current points using admin client (bypasses RLS).
  // league_id filter is required: without it any commissioner of any league
  // could adjust another league's scores by passing a foreign row id.
  const admin = createAdminClient();
  const { data: row, error: fetchErr } = await admin
    .from("uff_matchups")
    .select("points, score_adjustment")
    .eq("id", matchupRowId)
    .eq("league_id", leagueId)
    .maybeSingle();

  if (fetchErr || !row) {
    redirect(
      `/dashboard/league/${leagueId}/matchups?week=${week}&error=` +
        encodeURIComponent("Matchup row not found.")
    );
  }

  // score_adjustment is the cumulative commissioner delta; the scoring cron
  // recomputes points from scratch and re-applies this column, so adjustments
  // survive re-scoring instead of being overwritten 15 minutes later.
  const newPoints     = Math.round(((row.points ?? 0) + delta) * 100) / 100;
  const newAdjustment = Math.round(((row.score_adjustment ?? 0) + delta) * 100) / 100;

  const { error: updateErr } = await admin
    .from("uff_matchups")
    .update({ points: newPoints, score_adjustment: newAdjustment })
    .eq("id", matchupRowId)
    .eq("league_id", leagueId);

  if (updateErr) {
    redirect(
      `/dashboard/league/${leagueId}/matchups?week=${week}&error=` +
        encodeURIComponent(updateErr.message)
    );
  }

  revalidatePath(`/dashboard/league/${leagueId}/matchups`);
  revalidatePath(`/dashboard/league/${leagueId}/standings`);
  redirect(`/dashboard/league/${leagueId}/matchups?week=${week}&adjusted=1`);
}
