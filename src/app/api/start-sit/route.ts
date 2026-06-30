import { checkRateLimit } from "@/lib/rate-limit";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentNFLWeek } from "@/lib/nfl-utils";

const FLAG_KEYS = new Set([
  "pts_allow_0","pts_allow_1_6","pts_allow_7_13","pts_allow_14_20",
  "pts_allow_21_27","pts_allow_28_34","pts_allow_35p",
]);

interface RosterRow {
  player_id: string;
  slot: string;
  players: { full_name: string; position: string | null; team: string | null; injury_status: string | null } | null;
}

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

    const { data: league } = await supabase
      .from("uff_leagues")
      .select("season, lineup_slots, scoring_settings")
      .eq("id", league_id)
      .maybeSingle();
    if (!league) return NextResponse.json({ error: "League not found" }, { status: 404 });

    const week = getCurrentNFLWeek();

    const [{ data: rosterRows }, { data: lineupRows }] = await Promise.all([
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
    ]);

    const activeRoster = (rosterRows ?? []).filter(r => r.slot === "active" && r.players?.position);
    if (activeRoster.length === 0) {
      return NextResponse.json({ error: "No active roster found" }, { status: 400 });
    }

    const startingPlayerIds = new Set((lineupRows ?? []).map((l: { player_id: string }) => l.player_id));

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
          for (const r of activeRoster) {
            const stats = allProj[r.player_id] ?? {};
            let score = 0;
            for (const [key, mult] of Object.entries(scoringSettings)) {
              const val = stats[key];
              if (val == null || val === 0) continue;
              score += FLAG_KEYS.has(key) ? mult : val * mult;
            }
            projMap[r.player_id] = Math.round(score * 100) / 100;
          }
        }
      } catch { /* projections unavailable — pre-season or API down */ }
    }

    const slotsConfig: Record<string, number> =
      (league.lineup_slots as Record<string, number>) ?? { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DEF: 1 };
    const slotSummary = Object.entries(slotsConfig)
      .map(([pos, n]) => `${n}x ${pos}`)
      .join(", ");

    // Group players by position for the prompt
    const byPos: Record<string, { name: string; team: string; injury: string | null; proj: number; isStarting: boolean }[]> = {};
    for (const r of activeRoster) {
      const pos = r.players!.position!.toUpperCase();
      if (!byPos[pos]) byPos[pos] = [];
      byPos[pos].push({
        name: r.players!.full_name,
        team: r.players!.team ?? "FA",
        injury: r.players!.injury_status,
        proj: projMap[r.player_id] ?? 0,
        isStarting: startingPlayerIds.has(r.player_id),
      });
    }

    const POSITION_ORDER = ["QB", "RB", "WR", "TE", "FLEX", "K", "DEF", "DST"];
    const rosterStr = Object.entries(byPos)
      .sort(([a], [b]) => {
        const ai = POSITION_ORDER.indexOf(a);
        const bi = POSITION_ORDER.indexOf(b);
        return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
      })
      .map(([pos, players]) => {
        const lines = players
          .sort((a, b) => b.proj - a.proj)
          .map(p => {
            const tag = p.isStarting ? "[START]" : "[BENCH]";
            const inj = p.injury ? ` ⚠️${p.injury}` : "";
            const proj = p.proj > 0 ? ` proj ${p.proj.toFixed(1)}` : "";
            return `    ${tag} ${p.name} (${p.team})${proj}${inj}`;
          }).join("\n");
        return `  ${pos}:\n${lines}`;
      }).join("\n");

    const hasLineup = startingPlayerIds.size > 0;

    const prompt = `You are the UFF Start/Sit Advisor for Week ${week}.

Team: ${me.team_name}${me.faction ? ` (${me.faction} faction)` : ""}
Lineup format: ${slotSummary} | FLEX = RB/WR/TE eligible
${hasLineup ? "Lineup is already set — flag any urgent changes." : "No lineup set yet — recommend who to start."}

Roster:
${rosterStr}

Give 3-5 direct recommendations. Flag any BENCH player projecting higher than their STARTER at the same position, call out injury risks, and note obvious FLEX upgrades. Under 130 words — no fluff, just moves.`;

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "Advisor not configured" }, { status: 500 });

    const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 300,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!anthropicRes.ok) {
      const errText = await anthropicRes.text();
      console.error("Anthropic error (start-sit):", errText);
      return NextResponse.json({ error: "Advisor is unavailable — try again" }, { status: 502 });
    }

    const resData = await anthropicRes.json();
    const advice: string = resData.content?.[0]?.text ?? "";
    if (!advice) return NextResponse.json({ error: "No advice returned" }, { status: 500 });

    return NextResponse.json({ advice, week });
  } catch (err) {
    console.error("Start-sit error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
