"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

function rosterPaths(leagueId: string) {
  return [
    `/dashboard/league/${leagueId}/roster`,
    `/dashboard/league/${leagueId}/free-agents`,
    `/dashboard/league/${leagueId}/matchups`,
  ];
}

export async function addPlayer(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const leagueId = formData.get("leagueId") as string;
  const playerId = formData.get("playerId") as string;

  const { error } = await supabase.rpc("add_player", {
    p_league_id: leagueId,
    p_user_id: user.id,
    p_player_id: playerId,
  });

  if (error) {
    redirect(
      `/dashboard/league/${leagueId}/free-agents?error=` +
        encodeURIComponent(error.message)
    );
  }

  rosterPaths(leagueId).forEach((p) => revalidatePath(p));
  redirect(`/dashboard/league/${leagueId}/free-agents?added=1`);
}

export async function dropPlayer(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const leagueId = formData.get("leagueId") as string;
  const playerId = formData.get("playerId") as string;
  const returnTo = (formData.get("returnTo") as string) ?? "roster";

  const { error } = await supabase.rpc("drop_player", {
    p_league_id: leagueId,
    p_user_id: user.id,
    p_player_id: playerId,
  });

  if (error) {
    redirect(
      `/dashboard/league/${leagueId}/${returnTo}?error=` +
        encodeURIComponent(error.message)
    );
  }

  rosterPaths(leagueId).forEach((p) => revalidatePath(p));
  redirect(`/dashboard/league/${leagueId}/${returnTo}?dropped=1`);
}

export async function moveToIR(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const leagueId = formData.get("leagueId") as string;
  const playerId = formData.get("playerId") as string;

  const { error } = await supabase.rpc("move_to_ir", {
    p_league_id: leagueId,
    p_user_id: user.id,
    p_player_id: playerId,
  });

  if (error) {
    redirect(
      `/dashboard/league/${leagueId}/roster?error=` +
        encodeURIComponent(error.message)
    );
  }

  rosterPaths(leagueId).forEach((p) => revalidatePath(p));
  redirect(`/dashboard/league/${leagueId}/roster?ir=1`);
}

export async function moveFromIR(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const leagueId = formData.get("leagueId") as string;
  const playerId = formData.get("playerId") as string;

  const { error } = await supabase.rpc("move_from_ir", {
    p_league_id: leagueId,
    p_user_id: user.id,
    p_player_id: playerId,
  });

  if (error) {
    redirect(
      `/dashboard/league/${leagueId}/roster?error=` +
        encodeURIComponent(error.message)
    );
  }

  rosterPaths(leagueId).forEach((p) => revalidatePath(p));
  redirect(`/dashboard/league/${leagueId}/roster`);
}
