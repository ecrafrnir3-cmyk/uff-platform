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

  // ── Per-player game-time lock ─────────────────────────────────────────────
  const playerIds = Object.values(newAssignments);
  const now = new Date();

  // Kick off both lookups in parallel — fail gracefully if table not seeded yet
  const [{ data: games }, { data: playerRows }] = await Promise.all([
    supabase
      .from("uff_game_schedule")
      .select("team, kickoff_utc")
      .eq("season", 2026)
      .eq("week", week),
    supabase.from("players").select("id, team").in("id", playerIds),
  ]);

  // team abbr → kickoff Date
  const teamKickoff: Record<string, Date> = {};
  for (const g of games ?? []) teamKickoff[g.team] = new Date(g.kickoff_utc);

  // player_id → team abbr
  const playerTeam: Record<string, string> = {};
  for (const p of playerRows ?? []) { if (p.team) playerTeam[p.id] = p.team; }

  function isLocked(pid: string): boolean {
    const team = playerTeam[pid];
    if (!team) return false;
    const ko = teamKickoff[team];
    return ko ? now >= ko : false;
  }

  // ── Merge locked players with existing lineup ─────────────────────────────
  // If any submitted player's game has already started, we preserve their
  // current slot assignment instead of allowing a move.
  let finalSlots: { slot: string; player_id: string }[];
  const anyLocked = playerIds.some(isLocked);

  if (anyLocked) {
    // Fetch current lineup so we can preserve locked players' positions
    const { data: memberRow } = await supabase
      .from("league_members")
      .select("id")
      .eq("league_id", leagueId)
      .eq("user_id", user.id)
      .maybeSingle();

    let currentLineup: Record<string, string> = {};
    if (memberRow?.id) {
      const { data: rows } = await supabase
        .from("uff_lineups")
        .select("slot, player_id")
        .eq("member_id", memberRow.id)
        .eq("week", week);
      for (const r of rows ?? []) currentLineup[r.slot] = r.player_id;
    }

    // Build merged: start from new assignments, then enforce locked players back
    const merged: Record<string, string> = { ...newAssignments };

    // Re-lock: any slot whose current occupant has kicked off keeps them there
    for (const [slot, pid] of Object.entries(currentLineup)) {
      if (isLocked(pid)) merged[slot] = pid;
    }
    // Also block a locked player from appearing in a new slot they didn't occupy
    for (const [slot, pid] of Object.entries(merged)) {
      if (isLocked(pid) && currentLineup[slot] !== pid) delete merged[slot];
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
    p_slots:     JSON.stringify(finalSlots),
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
