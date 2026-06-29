"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentNFLWeek } from "@/lib/nfl-utils";

export async function proposeTrade(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const leagueId         = formData.get("leagueId") as string;
  const receiverId       = formData.get("receiverId") as string;
  const proposerPlayers  = formData.getAll("proposerPlayer") as string[];
  const receiverPlayers  = formData.getAll("receiverPlayer") as string[];

  // Enforce trade deadline
  const { data: leagueSettings } = await supabase
    .from("uff_leagues")
    .select("trade_deadline_week")
    .eq("id", leagueId)
    .maybeSingle();
  if (leagueSettings?.trade_deadline_week) {
    const currentWeek = getCurrentNFLWeek();
    if (currentWeek > leagueSettings.trade_deadline_week) {
      redirect(`/dashboard/league/${leagueId}/trade?error=${encodeURIComponent(
        `Trade deadline has passed (Week ${leagueSettings.trade_deadline_week}). No new trades are allowed.`
      )}`);
    }
  }

  if (!receiverId) {
    redirect(`/dashboard/league/${leagueId}/trade?error=${encodeURIComponent("Select a team to trade with.")}`);
  }
  if (proposerPlayers.length === 0) {
    redirect(`/dashboard/league/${leagueId}/trade?error=${encodeURIComponent("Select at least one player to offer.")}`);
  }
  if (receiverPlayers.length === 0) {
    redirect(`/dashboard/league/${leagueId}/trade?error=${encodeURIComponent("Select at least one player to request.")}`);
  }

  const { error } = await supabase.rpc("propose_trade", {
    p_league_id:           leagueId,
    p_receiver_id:         receiverId,
    p_proposer_player_ids: proposerPlayers,
    p_receiver_player_ids: receiverPlayers,
  });

  if (error) {
    redirect(`/dashboard/league/${leagueId}/trade?error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath(`/dashboard/league/${leagueId}/roster`);
  redirect(`/dashboard/league/${leagueId}/roster?trade=proposed`);
}

export async function respondToTrade(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const leagueId = formData.get("leagueId") as string;
  const tradeId  = formData.get("tradeId") as string;
  const accept   = formData.get("accept") === "true";

  // Enforce trade deadline for acceptances
  if (accept) {
    const { data: leagueSettings } = await supabase
      .from("uff_leagues")
      .select("trade_deadline_week")
      .eq("id", leagueId)
      .maybeSingle();
    if (leagueSettings?.trade_deadline_week) {
      const currentWeek = getCurrentNFLWeek();
      if (currentWeek > leagueSettings.trade_deadline_week) {
        redirect(`/dashboard/league/${leagueId}/roster?error=${encodeURIComponent(
          `Trade deadline has passed (Week ${leagueSettings.trade_deadline_week}). This trade can no longer be accepted.`
        )}`);
      }
    }
  }

  const { error } = await supabase.rpc("respond_to_trade", {
    p_trade_id: tradeId,
    p_accept:   accept,
  });

  if (error) {
    redirect(`/dashboard/league/${leagueId}/roster?error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath(`/dashboard/league/${leagueId}/roster`);
  redirect(`/dashboard/league/${leagueId}/roster?trade=${accept ? "accepted" : "rejected"}`);
}

export async function cancelTrade(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const leagueId = formData.get("leagueId") as string;
  const tradeId  = formData.get("tradeId") as string;

  const { error } = await supabase.rpc("cancel_trade", {
    p_trade_id: tradeId,
  });

  if (error) {
    redirect(`/dashboard/league/${leagueId}/roster?error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath(`/dashboard/league/${leagueId}/roster`);
  redirect(`/dashboard/league/${leagueId}/roster?trade=cancelled`);
}
