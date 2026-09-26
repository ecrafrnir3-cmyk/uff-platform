"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { SEASON } from "@/lib/nfl-utils";

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
      .eq("season", SEASON)
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
  // Slots whose requested change was refused because that game has already started.
  // The manager is told; silently shipping a short lineup is what used to happen.
  const refusedSlots: string[] = [];
  let quickFeetRowId: string | null = null;
  let quickFeetConsumed = false;

  if (anyLocked) {
    const { data: memberRow } = await supabase
      .from("league_members")
      .select("id")
      .eq("league_id", leagueId)
      .eq("user_id", user.id)
      .maybeSingle();

    const currentLineup: Record<string, string> = {};

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

    // Build merged lineup. The rule (Nate, 2026-09-26, the rulebook reading): Quick Feet
    // is a late injury swap — it lets ONE locked starter out per week, and the player
    // coming in must not have kicked off. A locked starter may still change slots. The
    // database enforces the same rule inside set_lineup and spends the token there.
    const merged: Record<string, string> = { ...newAssignments };
    const wasStarting = new Set(Object.values(currentLineup));

    // Re-lock: a locked starter who is being taken OUT of the lineup (not just moved)
    // needs Quick Feet; otherwise he stays in his slot.
    for (const [slot, pid] of Object.entries(currentLineup)) {
      if (!isLocked(pid)) continue;
      if (Object.values(newAssignments).includes(pid)) continue; // still starting, maybe elsewhere
      if (quickFeetRowId && !quickFeetConsumed) {
        quickFeetConsumed = true;
      } else {
        merged[slot] = pid;
        refusedSlots.push(slot);
      }
    }
    // A locked player who was not starting cannot come IN — Quick Feet or not. Put that
    // slot's previous occupant back rather than deleting the slot: deleting it left the
    // manager starting eight players, scoring 0 in the ninth, under a message that said
    // "saved". A locked starter changing slots is fine: he is starting either way.
    for (const [slot, pid] of Object.entries({ ...merged })) {
      if (isLocked(pid) && currentLineup[slot] !== pid && !wasStarting.has(pid)) {
        const previous = currentLineup[slot];
        const previousStartingElsewhere = previous
          ? Object.entries(merged).some(([s, p]) => s !== slot && p === previous)
          : false;
        if (previous && !previousStartingElsewhere) merged[slot] = previous;
        else delete merged[slot];
        refusedSlots.push(slot);
      }
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

  // Quick Feet is spent inside set_lineup, in the same transaction as the save
  // (OPEN-LOOPS #77, audit A2-06); the token table no longer accepts a status
  // update from the app. quickFeetConsumed above only shapes the UI decision.

  revalidatePath(`/dashboard/league/${leagueId}/roster`);
  revalidatePath(`/dashboard/league/${leagueId}/matchups`);

  const refused = [...new Set(refusedSlots)];
  if (refused.length > 0) {
    redirect(
      `/dashboard/league/${leagueId}/roster?error=` +
        encodeURIComponent(
          `Lineup saved, but ${refused.length} change${refused.length > 1 ? "s were" : " was"} refused — ` +
            `${refused.join(", ")}: those games have already kicked off.`
        )
    );
  }
  redirect(`/dashboard/league/${leagueId}/roster?lineup=saved`);
}
