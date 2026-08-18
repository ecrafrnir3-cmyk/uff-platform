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
import { getRecord, CompletedMatchupRow } from "@/lib/get-record";
import { createNotification } from "@/lib/notifications";

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

  // ── Email notification to receiver (with Oracle AI analysis) ──────────────
  try {
    const [receiverInfo, proposerInfo, leagueName, pNames, rNames] = await Promise.all([
      getMemberInfo(supabase, receiverId),
      supabase
        .from("league_members")
        .select("id, team_name, faction")
        .eq("league_id", leagueId)
        .eq("user_id", user.id)
        .maybeSingle(),
      getLeagueName(supabase, leagueId),
      getPlayerNames(supabase, proposerPlayers),
      getPlayerNames(supabase, receiverPlayers),
    ]);

    // ── Oracle trade analysis ──────────────────────────────────────────────
    let aiAnalysis: string | undefined;
    try {
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (apiKey && proposerInfo.data?.id) {
        const [{ data: allMatchups }, { data: receiverMember }] = await Promise.all([
          supabase
            .from("uff_matchups")
            .select("matchup_id, member_id, points")
            .eq("league_id", leagueId)
            .eq("is_complete", true)
            .returns<CompletedMatchupRow[]>(),
          supabase
            .from("league_members")
            .select("team_name, faction")
            .eq("id", receiverId)
            .maybeSingle(),
        ]);

        const rows = allMatchups ?? [];
        const proposerRecord = getRecord(proposerInfo.data.id, rows);
        const receiverRecord = getRecord(receiverId, rows);

        const proposerTeam = proposerInfo.data.team_name ?? "Team A";
        const receiverTeam = receiverMember?.team_name ?? "Team B";

        const prompt = `You are the Oracle of Ultimate Fantasy Football. Evaluate this trade briefly.

${proposerTeam} [${proposerInfo.data.faction ?? "?"}] (${proposerRecord.wins}W-${proposerRecord.losses}L) SENDS: ${pNames.join(", ")}
${receiverTeam} [${receiverMember?.faction ?? "?"}] (${receiverRecord.wins}W-${receiverRecord.losses}L) SENDS BACK: ${rNames.join(", ")}

2-3 sentence analysis only. Who benefits more and why? End with exactly one of: VERDICT: FAIR | VERDICT: SLIGHT EDGE TO [team name] | VERDICT: AVOID — [team name] is getting robbed`;

        const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model: "claude-haiku-4-5-20251001",
            max_tokens: 200,
            messages: [{ role: "user", content: prompt }],
          }),
        });

        if (anthropicRes.ok) {
          const aiData = await anthropicRes.json();
          aiAnalysis = aiData.content?.[0]?.text ?? undefined;
        }
      }
    } catch (aiErr) {
      console.error("[trade] AI analysis failed (non-blocking):", aiErr);
      // Non-blocking — email sends without analysis if this fails
    }

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
            aiAnalysis,
          }),
        });
      }
      // In-app notification
      await createNotification({
        leagueId,
        userId: receiverInfo.user_id,
        type: "trade_proposed",
        title: `Trade offer from ${proposerInfo.data?.team_name ?? "A manager"}`,
        body: `They offer: ${pNames.join(", ")} — They want: ${rNames.join(", ")}`,
      });
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

  // Enforce trade deadline + roster-size limits for acceptances
  if (accept) {
    const { data: leagueSettings } = await supabase
      .from("uff_leagues")
      .select("trade_deadline_week, draft_rounds, lineup_slots")
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

    // Uneven trades (2-for-1 etc.) must leave BOTH rosters legal: no more than
    // the roster cap (draft_rounds) and no fewer than the starter count.
    const { data: tradeRow } = await supabase
      .from("uff_trades")
      .select("proposer_id, receiver_id, proposer_player_ids, receiver_player_ids")
      .eq("id", tradeId)
      .maybeSingle();
    if (tradeRow && leagueSettings) {
      const giveP = (tradeRow.proposer_player_ids as string[] | null)?.length ?? 0;
      const giveR = (tradeRow.receiver_player_ids as string[] | null)?.length ?? 0;
      const { data: activeRows } = await supabase
        .from("uff_roster_players")
        .select("member_id")
        .in("member_id", [tradeRow.proposer_id, tradeRow.receiver_id])
        .is("dropped_at", null)
        .eq("slot", "active");
      const counts: Record<string, number> = {};
      for (const r of activeRows ?? []) counts[r.member_id] = (counts[r.member_id] ?? 0) + 1;
      const cap = leagueSettings.draft_rounds as number;
      const slots = (leagueSettings.lineup_slots as Record<string, number> | null) ?? { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DEF: 1 };
      const minStarters = Object.values(slots).reduce((s, n) => s + Number(n), 0);
      const postProposer = (counts[tradeRow.proposer_id] ?? 0) - giveP + giveR;
      const postReceiver = (counts[tradeRow.receiver_id] ?? 0) - giveR + giveP;
      const bad =
        postProposer > cap ? `the proposer over the ${cap}-player roster limit (${postProposer})` :
        postReceiver > cap ? `you over the ${cap}-player roster limit (${postReceiver})` :
        postProposer < minStarters ? `the proposer under the ${minStarters}-starter minimum (${postProposer})` :
        postReceiver < minStarters ? `you under the ${minStarters}-starter minimum (${postReceiver})` :
        null;
      if (bad) {
        redirect(`/dashboard/league/${leagueId}/roster?error=${encodeURIComponent(
          `This trade would leave ${bad}. Adjust the players involved and re-propose.`
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
        // In-app notification
        const responder = responderInfo.data?.team_name ?? "Your trade partner";
        await createNotification({
          leagueId,
          userId: proposerInfo.user_id,
          type: accept ? "trade_accepted" : "trade_rejected",
          title: accept
            ? `${responder} accepted your trade${tradeStatus === "pending_review" ? " (pending commissioner review)" : ""}`
            : `${responder} rejected your trade`,
        });
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
      if (email) {
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
      }
      // In-app notification
      await createNotification({
        leagueId,
        userId: info.user_id,
        type: "trade_approved",
        title: "Your trade was approved by the commissioner",
        body: "Rosters have been updated.",
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
      if (email) {
        await sendEmail({
          to: email,
          subject: `Trade vetoed in ${leagueName}`,
          html: tradeVetoedHtml({ leagueId, leagueName, reason }),
        });
      }
      // In-app notification
      await createNotification({
        leagueId,
        userId: info.user_id,
        type: "trade_vetoed",
        title: "Your trade was vetoed by the commissioner",
        body: reason ? `Reason: "${reason}"` : undefined,
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
