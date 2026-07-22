import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getCurrentNFLWeek } from "@/lib/nfl-utils";
import { sendEmail, getUserEmail, waiverResultsHtml } from "@/lib/email";
import { createNotification } from "@/lib/notifications";

// ─── Called by GitHub Actions every hour ────────────────────────────────────
// Checks each FAAB league's waiver schedule (waiver_day + waiver_hour in ET).
// If the current ET day/hour matches, runs process_waiver_bids for that league.
// Uses ET = UTC-5 (fixed offset — no DST adjustment for simplicity).

interface LeagueRow {
  id: string;
  name: string;
  commissioner_id: string;
  waiver_day: number;
  waiver_hour: number;
  waiver_type: "faab" | "priority";
}

export async function GET(req: NextRequest) {
  // Fail closed if the secret was never configured (audit M1)
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json({ error: "Missing server config" }, { status: 500 });
  }

  const supabase = createClient(supabaseUrl, serviceKey);

  // Current time in Eastern — DST-aware.
  // EDT = UTC-4 (2nd Sun Mar → 1st Sun Nov), EST = UTC-5 (rest of year).
  // NFL season runs Sep–Feb so we must handle the EDT→EST transition in Nov.
  const nowUTC = new Date();
  const month  = nowUTC.getUTCMonth(); // 0=Jan, 10=Nov
  const day    = nowUTC.getUTCDate();
  const dow    = nowUTC.getUTCDay();   // 0=Sun
  // DST ends first Sunday of November. Simple conservative check:
  // Use UTC-4 (EDT) from March through October, UTC-5 (EST) November–February.
  const isEDT  = month >= 2 && month <= 9; // March(2) through October(9)
  void day; void dow; // suppress unused warnings (kept for future fine-grained DST calc)
  const etOffsetMs = isEDT ? 4 * 60 * 60 * 1000 : 5 * 60 * 60 * 1000;
  const nowET  = new Date(nowUTC.getTime() - etOffsetMs);
  const etDow  = nowET.getUTCDay();    // 0=Sun, 1=Mon, ..., 6=Sat
  const etHour = nowET.getUTCHours(); // 0-23

  const week = getCurrentNFLWeek();

  // Find leagues with auto-waiver enabled for this exact ET day + hour
  const { data: leagues, error: fetchErr } = await supabase
    .from("uff_leagues")
    .select("id, name, commissioner_id, waiver_day, waiver_hour, waiver_type")
    .eq("waiver_auto", true)
    .eq("waiver_day", etDow)
    .eq("waiver_hour", etHour)
    .returns<LeagueRow[]>();

  if (fetchErr) {
    return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  }

  if (!leagues || leagues.length === 0) {
    return NextResponse.json({
      processed: 0,
      week,
      et_day: etDow,
      et_hour: etHour,
      results: [],
    });
  }

  const results = [];
  for (const league of leagues) {
    const isFaab = league.waiver_type !== "priority";
    const { data, error } = isFaab
      ? await supabase.rpc("process_waiver_bids", {
          p_league_id: league.id,
          p_user_id:   league.commissioner_id,
          p_week:      week,
        })
      : await supabase.rpc("process_priority_waivers", {
          p_league_id: league.id,
          p_week:      week,
        });
    results.push({
      league_id:   league.id,
      league_name: league.name,
      claims:      error ? null : (data ?? 0),
      error:       error?.message ?? null,
    });

    // ── Email waiver results to each manager who had bids ──────────────────
    if (!error) {
      try {
        // Only bids processed in THIS run (cron is hourly; 65-min window).
        // Two past bugs here (audit C4/cron-H4): the FAAB processor writes
        // 'won'/'lost' (not 'awarded'/'rejected'), so FAAB leagues never got
        // result emails — and without the processed_at window, every matching
        // run re-emailed ALL of the week's old results.
        const processedSince = new Date(Date.now() - 65 * 60 * 1000).toISOString();
        const { data: bids } = await supabase
          .from("uff_waiver_bids")
          .select("member_id, player_id, bid_amount, status")
          .eq("league_id", league.id)
          .in("status", ["awarded", "rejected", "won", "lost"])
          .gte("processed_at", processedSince);

        if (bids && bids.length > 0) {
          // Get all unique player IDs and member IDs
          const playerIds = [...new Set(bids.map((b: { player_id: string }) => b.player_id))];
          const memberIds = [...new Set(bids.map((b: { member_id: string }) => b.member_id))];

          // Fetch player names
          const { data: players } = await supabase
            .from("players")
            .select("id, full_name")
            .in("id", playerIds);
          const playerMap: Record<string, string> = {};
          for (const p of players ?? []) playerMap[p.id] = p.full_name;

          // Fetch member user_ids
          const { data: members } = await supabase
            .from("league_members")
            .select("id, user_id")
            .in("id", memberIds);
          const memberUserMap: Record<string, string> = {};
          for (const m of members ?? []) memberUserMap[m.id] = m.user_id;

          // Group bids by member ('won'/'awarded' = success, 'lost'/'rejected' = miss)
          const byMember: Record<string, { awarded: typeof bids; rejected: typeof bids }> = {};
          for (const bid of bids) {
            if (!byMember[bid.member_id]) byMember[bid.member_id] = { awarded: [], rejected: [] };
            if (bid.status === "awarded" || bid.status === "won") byMember[bid.member_id].awarded.push(bid);
            else byMember[bid.member_id].rejected.push(bid);
          }

          // Send one summary email per manager
          await Promise.all(
            Object.entries(byMember).map(async ([memberId, { awarded, rejected }]) => {
              const userId = memberUserMap[memberId];
              if (!userId) return;
              const awardedNames = awarded.map((b: { player_id: string; bid_amount: number }) => ({
                playerName: playerMap[b.player_id] ?? b.player_id,
                bidAmount: b.bid_amount,
              }));
              const rejectedNames = rejected.map((b: { player_id: string; bid_amount: number }) => ({
                playerName: playerMap[b.player_id] ?? b.player_id,
                bidAmount: b.bid_amount,
              }));

              const email = await getUserEmail(userId);
              if (email) {
                await sendEmail({
                  to: email,
                  subject: `${league.name} · Week ${week} Waiver Results`,
                  html: waiverResultsHtml({
                    leagueId: league.id,
                    leagueName: league.name,
                    week,
                    awarded: awardedNames,
                    rejected: rejectedNames,
                  }),
                });
              }

              // In-app notification
              if (awardedNames.length > 0 || rejectedNames.length > 0) {
                const parts: string[] = [];
                if (awardedNames.length > 0) parts.push(`Awarded: ${awardedNames.map(a => a.playerName).join(", ")}`);
                if (rejectedNames.length > 0) parts.push(`Missed: ${rejectedNames.map(r => r.playerName).join(", ")}`);
                await createNotification({
                  leagueId: league.id,
                  userId,
                  type: "waiver_results",
                  title: `Week ${week} waiver results`,
                  body: parts.join(" · "),
                });
              }
            })
          );
          console.log(`[process-waivers] Emailed waiver results to ${Object.keys(byMember).length} managers: ${league.name}`);
        }
      } catch (emailErr) {
        console.error(`[process-waivers] Email failed for ${league.name}:`, emailErr);
      }
    }
  }

  const successCount = results.filter((r) => r.error === null).length;
  console.log(
    `[process-waivers] ET ${etDow}/${etHour} • week ${week} • ${successCount}/${leagues.length} leagues processed`
  );

  return NextResponse.json({
    processed: successCount,
    week,
    et_day:  etDow,
    et_hour: etHour,
    results,
  });
}
