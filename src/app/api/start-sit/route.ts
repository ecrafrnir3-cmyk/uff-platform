import { checkRateLimit } from "@/lib/rate-limit";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentNFLWeek } from "@/lib/nfl-utils";
import {
  buildStartSitPrompt,
  fillStartSitProjections,
  readStartSitReply,
  startSitActiveRoster,
  startSitRequest,
  type StartSitRosterRow as RosterRow,
} from "@/lib/ai-prompts/start-sit";

export async function POST(req: NextRequest) {
  try {
    const { league_id } = await req.json();
    if (!league_id) return NextResponse.json({ error: "Missing league_id" }, { status: 400 });

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { data: me } = await supabase
      .from("league_members")
      .select("id, team_name, faction")
      .eq("league_id", league_id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!me) return NextResponse.json({ error: "Not a member" }, { status: 403 });

    const rl = await checkRateLimit(`${user.id}:start-sit`, 5);
    if (!rl.allowed) return NextResponse.json({ error: "Rate limit exceeded — try again in a minute." }, { status: 429 });

    const { data: league } = await supabase
      .from("uff_leagues")
      .select("season, lineup_slots, scoring_settings")
      .eq("id", league_id)
      .maybeSingle();
    if (!league) return NextResponse.json({ error: "League not found" }, { status: 404 });

    const week = getCurrentNFLWeek();

    const [{ data: rosterRows }, { data: lineupRows }, { data: scheduleRows }] = await Promise.all([
      supabase
        .from("uff_roster_players")
        .select("player_id, slot, players(full_name, position, team, injury_status)")
        .eq("member_id", me.id)
        .is("dropped_at", null)
        .returns<RosterRow[]>(),
      supabase
        .from("uff_lineups")
        .select("slot, player_id")
        .eq("member_id", me.id)
        .eq("week", week),
      // BYE weeks: a team ABSENT from this week's schedule is on bye. The advisor was
      // blind to this until 2026-10-10 — a bye player arrived in the prompt with no
      // projection token, which is indistinguishable from "Sleeper had no number for
      // him", so the model could not tell "scores exactly zero" from "unknown".
      supabase
        .from("uff_game_schedule")
        .select("team")
        .eq("season", Number(league.season))
        .eq("week", week),
    ]);

    const activeRoster = startSitActiveRoster(rosterRows);
    if (activeRoster.length === 0) {
      return NextResponse.json({ error: "No active roster found" }, { status: 400 });
    }

    // Fetch projections from Sleeper
    const scoringSettings: Record<string, number> = (league.scoring_settings as Record<string, number>) ?? {};
    const projMap: Record<string, number> = {};

    if (Object.keys(scoringSettings).length > 0) {
      try {
        const projRes = await fetch(
          `https://api.sleeper.app/v1/projections/nfl/${league.season}/${week}?season_type=regular`,
          { next: { revalidate: 900 } }
        );
        if (projRes.ok) {
          const allProj: Record<string, Record<string, number>> = await projRes.json();
          fillStartSitProjections(projMap, activeRoster, allProj, scoringSettings);
        }
      } catch { /* projections unavailable — pre-season or API down */ }
    }

    // The prompt (bye marks, projections, lineup tags) is built in @/lib/ai-prompts/start-sit.
    const prompt = buildStartSitPrompt({
      week,
      me,
      lineupSlots: league.lineup_slots,
      activeRoster,
      lineupRows,
      scheduleRows,
      projMap,
    });

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "Advisor not configured" }, { status: 500 });

    const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify(startSitRequest(prompt)),
    });

    if (!anthropicRes.ok) {
      const errText = await anthropicRes.text();
      console.error("Anthropic error (start-sit):", errText);
      return NextResponse.json({ error: "Advisor is unavailable — try again" }, { status: 502 });
    }

    const resData = await anthropicRes.json();
    const advice: string = readStartSitReply(resData);
    if (!advice) return NextResponse.json({ error: "No advice returned" }, { status: 500 });

    return NextResponse.json({ advice, week });
  } catch (err) {
    console.error("Start-sit error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
