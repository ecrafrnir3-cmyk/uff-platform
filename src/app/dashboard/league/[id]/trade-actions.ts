"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentNFLWeek } from "@/lib/nfl-utils";
import {
  sendEmail,
  getUserEmail,
  tradeProposedHtml,
  tradeRespondedHtml,
  tradeVetoedHtml,
} from "@/lib/email";

// ── Helpers ───────────────────────────────────────────────────────────────────

async function getLeagueName(supabase: Awaited<ReturnType<typeof createClient>>, leagueId: string) {
  const { data } = await supabase.from("uff_leagues").select("name").eq("id", leagueId).maybeSingle();
  return data?.name ?? "Your League";
}

async function getMemberInfo(supabase: Awaited<ReturnType<typeof createClient>>, memberId: string) {
  const { data } = await supabase
    .from("league_members")
    .select("user_id, team_name")
    .eq("id", memberId)
    .maybeSingle();
  return data;
}

async function getPlayerNames(supabase: Awaited<ReturnType<typeof createClient>>, playerIds: string[]) {
  if (playerIds.length === 0) return [];
  const { data } = await supabase
    .from("players")
    .select("id, full_name")
    .in("id", playerIds);
  const nameMap: Record<string, string> = {};
  for (const p of data ?? []) nameMap[p.id] = p.full_name;
  return playerIds.map((id) => nameMap[id] ?? id);
}

// ── Actions ───────────────────────────────────────────────────────────────────

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

  // ── Email notification to receiver ─────────────────────────────────────────
  try {
    const [receiverInfo, proposerInfo, leagueName, pNames, rNames] = await Promise.all([
      getMemberInfo(supabase, receiverId),
      supabase.from("league_members").select("team_name").eq("league_id", leagueId).eq("user_id", user.id).maybeSingle(),
      getLeagueName(supabase, leagueId),
      getPlayerNames(supabase, proposerPlayers),
      getPlayerNames(supabase, receiverPlayers),
    ]);
    if (receiverInfo?.user_id) {
      const receiverEmail = await getUserEmail(receiverInfo.user_id);
      if (receiverEmail) {
        await sendEmail({
          to: receiverEmail,
          subject: `New trade offer in ${leagueName}`,
          html: tradeProposedHtml({
            leagueId,
            leagueName,
            proposerTeamName: proposerInfo.data?.team_name ?? "A manager",
            proposerPlayers: pNames,
            receiverPlayers: rNames,
          }),
        });
      }
    }
  } catch (emailErr) {
    console.error("[trade] email notification failed:", emailErr);
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

  // Re-read trade to get proposer_id and final status
  const { data: updatedTrade } = await supabase
    .from("uff_trades")
    .select("status, proposer_id")
    .eq("id", tradeId)
    .maybeSingle();
  const tradeStatus = updatedTrade?.status ?? (accept ? "accepted" : "rejected");

  // ── Email notification to proposer ─────────────────────────────────────────
  try {
    if (updatedTrade?.proposer_id) {
      const [proposerInfo, responderInfo, leagueName] = await Promise.all([
        getMemberInfo(supabase, updatedTrade.proposer_id),
        supabase.from("league_members").select("team_name").eq("league_id", leagueId).eq("user_id", user.id).maybeSingle(),
        getLeagueName(supabase, leagueId),
      ]);
      if (proposerInfo?.user_id) {
        const proposerEmail = await getUserEmail(proposerInfo.user_id);
        if (proposerEmail) {
          await sendEmail({
            to: proposerEmail,
            subject: `Your trade was ${accept ? "accepted" : "rejected"} in ${leagueName}`,
            html: tradeRespondedHtml({
              leagueId,
              leagueName,
              responderTeamName: responderInfo.data?.team_name ?? "Your trade partner",
              accepted: accept,
              pendingReview: tradeStatus === "pending_review",
            }),
          });
        }
      }
    }
  } catch (emailErr) {
    console.error("[trade] email notification failed:", emailErr);
  }

  revalidatePath(`/dashboard/league/${leagueId}/roster`);
  if (!accept) {
    redirect(`/dashboard/league/${leagueId}/roster?trade=rejected`);
  }
  redirect(`/dashboard/league/${leagueId}/roster?trade=${tradeStatus === "pending_review" ? "review" : "accepted"}`);
}

export async function approveTrade(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const leagueId = formData.get("leagueId") as string;
  const tradeId  = formData.get("tradeId") as string;

  // Grab trade parties before approving
  const { data: trade } = await supabase
    .from("uff_trades")
    .select("proposer_id, receiver_id")
    .eq("id", tradeId)
    .maybeSingle();

  const { error } = await supabase.rpc("approve_trade", { p_trade_id: tradeId });
  if (error) {
    redirect(`/dashboard/league/${leagueId}/settings?error=${encodeURIComponent(error.message)}`);
  }

  // ── Email both parties ──────────────────────────────────────────────────────
  try {
    const leagueName = await getLeagueName(supabase, leagueId);
    const partyIds = [trade?.proposer_id, trade?.receiver_id].filter(Boolean) as string[];
    await Promise.all(partyIds.map(async (memberId) => {
      const info = await getMemberInfo(supabase, memberId);
      if (!info?.user_id) return;
      const email = await getUserEmail(info.user_id);
      if (!email) return;
      await sendEmail({
        to: email,
        subject: `Trade approved in ${leagueName}`,
        html: tradeRespondedHtml({
          leagueId,
          leagueName,
          responderTeamName: "The Commissioner",
          accepted: true,
          pendingReview: false,
        }),
      });
    }));
  } catch (emailErr) {
    console.error("[trade] approval email failed:", emailErr);
  }

  revalidatePath(`/dashboard/league/${leagueId}/roster`);
  revalidatePath(`/dashboard/league/${leagueId}/settings`);
  redirect(`/dashboard/league/${leagueId}/settings?approved=1`);
}

export async function vetoTrade(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const leagueId = formData.get("leagueId") as string;
  const tradeId  = formData.get("tradeId") as string;
  const reason   = (formData.get("reason") as string)?.trim() || null;

  // Grab trade parties before vetoing
  const { data: trade } = await supabase
    .from("uff_trades")
    .select("proposer_id, receiver_id")
    .eq("id", tradeId)
    .maybeSingle();

  const { error } = await supabase.rpc("veto_trade", {
    p_trade_id: tradeId,
    p_reason:   reason,
  });
  if (error) {
    redirect(`/dashboard/league/${leagueId}/settings?error=${encodeURIComponent(error.message)}`);
  }

  // ── Email both parties ──────────────────────────────────────────────────────
  try {
    const leagueName = await getLeagueName(supabase, leagueId);
    const partyIds = [trade?.proposer_id, trade?.receiver_id].filter(Boolean) as string[];
    await Promise.all(partyIds.map(async (memberId) => {
      const info = await getMemberInfo(supabase, memberId);
      if (!info?.user_id) return;
      const email = await getUserEmail(info.user_id);
      if (!email) return;
      await sendEmail({
        to: email,
        subject: `Trade vetoed in ${leagueName}`,
        html: tradeVetoedHtml({ leagueId, leagueName, reason }),
      });
    }));
  } catch (emailErr) {
    console.error("[trade] veto email failed:", emailErr);
  }

  revalidatePath(`/dashboard/league/${leagueId}/roster`);
  revalidatePath(`/dashboard/league/${leagueId}/settings`);
  redirect(`/dashboard/league/${leagueId}/settings?vetoed=1`);
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
