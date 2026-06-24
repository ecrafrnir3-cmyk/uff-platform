"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function setLineup(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const leagueId = formData.get("leagueId") as string;
  const week     = parseInt(formData.get("week") as string);

  // Collect new slot assignments from form
  const newAssignments: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (key.startsWith("slot_") && value && value !== "") {
      newAssignments[key.replace("slot_", "")] = value as string;
    }
  }

  if (Object.keys(newAssignments).length === 0) {
    redirect(
      `/dashboard/league/${leagueId}/roster?error=${encodeURIComponent("No starters selected.")}`
    );
  }

  // Per-player game-time lock
  const playerIds = Object.values(newAssignments);
  const now = new Date();

  const [{ data: games }, { data: playerRows }] = await Promise.all([
    supabase
      .from("uff_game_schedule")
      .select("team, kickoff_utc")
      .eq("season", 2026)
      .eq("week", week),
    supabase.from("players").select("id, team").in("id", playerIds),
  ]);

  // team abbr to kickoff Date
  const teamKickoff: Record<string, Date> = {};
  for (const g of games ?? []) teamKickoff[g.team] = new Date(g.kickoff_utc);

  // player_id to team abbr
  const playerTeam: Record<string, string> = {};
  for (const p of playerRows ?? []) { if (p.team) playerTeam[p.id] = p.team; }

  function isLocked(pid: string): boolean {
    const team = playerTeam[pid];
    if (!team) return false;
    const ko = teamKickoff[team];
    return ko ? now >= ko : false;
  }

  // Merge locked players with existing lineup
  let finalSlots: { slot: string; player_id: string }[];
  const anyLocked = playerIds.some(isLocked);

  if (anyLocked) {
    const { data: memberRow } = await supabase
      .from("league_members")
      .select("id")
      .eq("league_id", leagueId)
      .eq("user_id", user.id)
      .maybeSingle();

    let currentLineup: Record<string, string> = {};
    let quickFeetRowId: string | null = null;

    if (memberRow?.id) {
      const [{ data: rows }, { data: qfToken }] = await Promise.all([
        supabase
          .from("uff_lineups")
          .select("slot, player_id")
          .eq("member_id", memberRow.id)
          .eq("week", week),
        // Token 13 (Quick Feet): allows one locked-player swap per week
        supabase
          .from("weekly_token_assignments")
          .select("id")
          .eq("league_id", leagueId)
          .eq("member_id", memberRow.id)
          .eq("week", week)
          .eq("token_id", 13)
          .eq("status", "pending")
          .maybeSingle(),
      ]);
      for (const r of rows ?? []) currentLineup[r.slot] = r.player_id;
      quickFeetRowId = qfToken?.id ?? null;
    }

    // Build merged lineup. Quick Feet allows one locked-slot change through.
    const merged: Record<string, string> = { ...newAssignments };
    let quickFeetConsumed = false;

    // Re-lock: any slot whose current occupant has kicked off keeps them there
    for (const [slot, pid] of Object.entries(currentLineup)) {
      if (isLocked(pid)) {
        const newPid = newAssignments[slot];
        if (newPid !== pid) {
          if (quickFeetRowId && !quickFeetConsumed) {
            quickFeetConsumed = true;
          } else {
            merged[slot] = pid;
          }
        }
      }
    }
    // Block a locked player from appearing in a new slot they did not occupy
    for (const [slot, pid] of Object.entries(merged)) {
      if (isLocked(pid) && currentLineup[slot] !== pid) {
        if (quickFeetRowId && !quickFeetConsumed) {
          quickFeetConsumed = true;
        } else {
          delete merged[slot];
        }
      }
    }

    // Mark Quick Feet as used if the swap was exercised
    if (quickFeetConsumed && quickFeetRowId) {
      await supabase
        .from("weekly_token_assignments")
        .update({ status: "used", used_at: new Date().toISOString() })
        .eq("id", quickFeetRowId);
    }

    finalSlots = Object.entries(merged).map(([slot, player_id]) => ({ slot, player_id }));
  } else {
    finalSlots = Object.entries(newAssignments).map(([slot, player_id]) => ({ slot, player_id }));
  }

  if (finalSlots.length === 0) {
    redirect(
      `/dashboard/league/${leagueId}/roster?error=${encodeURIComponent("No valid starters to save.")}`
    );
  }

  const { error } = await supabase.rpc("set_lineup", {
    p_league_id: leagueId,
    p_user_id:   user.id,
    p_week:      week,
    p_slots:     finalSlots,
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
