import { checkRateLimit } from "@/lib/rate-limit";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// AFC and NFC team lookup for faction-alignment advice
const AFC_TEAMS = new Set([
  "BAL","CIN","CLE","PIT",        // AFC North
  "BUF","MIA","NE","NYJ",         // AFC East
  "HOU","IND","JAC","TEN",        // AFC South
  "DEN","KC","LV","LAC",          // AFC West
]);

function conference(team: string | null): string {
  if (!team) return "?";
  return AFC_TEAMS.has(team.toUpperCase()) ? "AFC" : "NFC";
}

interface PlayerRow {
  id: string;
  full_name: string;
  position: string | null;
  team: string | null;
  adp: number | null;
}

interface PickRow {
  member_id: string;
  player_id: string;
  round: number;
  pick_no: number;
  players: { full_name: string; position: string | null; team: string | null } | null;
}

export async function POST(req: NextRequest) {
  try {
    const { league_id } = await req.json();
    if (!league_id) return NextResponse.json({ error: "Missing league_id" }, { status: 400 });

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    // Get my membership + faction
    const { data: me } = await supabase
      .from("league_members")
      .select("id, team_name, faction")
      .eq("league_id", league_id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!me) return NextResponse.json({ error: "Not a member" }, { status: 403 });

    // Get league info (max_teams for round calculation)
    const { data: league } = await supabase
      .from("uff_leagues")
      .select("max_teams, draft_rounds, draft_status")
      .eq("id", league_id)
      .maybeSingle();
    if (!league) return NextResponse.json({ error: "League not found" }, { status: 404 });

    if (league.draft_status !== "in_progress") {
      return NextResponse.json({ error: "Draft is not in progress" }, { status: 400 });
    }

    // Get all picks for this league (to know what's taken + my roster)
    const { data: allPicks } = await supabase
      .from("uff_draft_picks")
      .select("member_id, player_id, round, pick_no, players(full_name, position, team)")
      .eq("league_id", league_id)
      .order("pick_no", { ascending: true })
      .returns<PickRow[]>();

    const picks = allPicks ?? [];
    const pickedIds = new Set(picks.map((p) => p.player_id));
    const myPicks = picks.filter((p) => p.member_id === me.id);
    const totalPicksSoFar = picks.length;
    const currentRound = Math.ceil((totalPicksSoFar + 1) / league.max_teams);

    // Build my current roster grouped by position
    const rosterByPos: Record<string, string[]> = {};
    for (const pick of myPicks) {
      const pos = pick.players?.position ?? "UNK";
      if (!rosterByPos[pos]) rosterByPos[pos] = [];
      const conf = conference(pick.players?.team ?? null);
      rosterByPos[pos].push(`${pick.players?.full_name ?? "?"}  (${pick.players?.team ?? "?"}, ${conf})`);
    }

    const rosterStr = Object.entries(rosterByPos)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([pos, names]) => `  ${pos}: ${names.join(", ")}`)
      .join("\n") || "  (no picks yet)";

    // Get top available players by ADP (not already picked)
    const { data: allPlayers } = await supabase
      .from("players")
      .select("id, full_name, position, team, adp")
      .not("position", "is", null)
      .order("adp", { ascending: true, nullsFirst: false })
      .limit(200)
      .returns<PlayerRow[]>();

    const available = (allPlayers ?? [])
      .filter((p) => !pickedIds.has(p.id))
      .slice(0, 30);

    if (available.length === 0) {
      return NextResponse.json({ error: "No available player data found" }, { status: 400 });
    }

    const availableStr = available.map((p, i) => {
      const conf = conference(p.team);
      const factionMatch = (me.faction === "hero" && conf === "AFC") || (me.faction === "villain" && conf === "NFC");
      const tag = factionMatch ? " ⚡FACTION" : "";
      return `${i + 1}. ${p.full_name} — ${p.position ?? "?"} — ${p.team ?? "FA"} (${conf})${tag}`;
    }).join("\n");

    const factionDesc = me.faction === "hero"
      ? "Hero (AFC) — gets bonus points from AFC players"
      : me.faction === "villain"
      ? "Villain (NFC) — gets bonus points from NFC players"
      : "No faction assigned";

    const picksLeft = (league.draft_rounds * league.max_teams) - totalPicksSoFar;

    const prompt = `You are the Oracle Draft Advisor for Ultimate Fantasy Football.

Team: ${me.team_name} — ${factionDesc}
Current round: ${currentRound} of ${league.draft_rounds}
Total picks remaining in draft: ${picksLeft}

My current roster:
${rosterStr}

Top 30 available players (by ADP — ⚡FACTION = matches my faction bonus):
${availableStr}

Give concise draft advice (2-3 sentences): consider position scarcity (TE/QB dry up fast in later rounds), roster balance needs, and faction-alignment value (⚡FACTION players score bonus points for me). Then state:
PICK: [Full Player Name] ([POS], [TEAM])

No intro, just advice + PICK line.`;

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "Oracle not configured" }, { status: 500 });

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

    if (!anthropicRes.ok) {
      const errText = await anthropicRes.text();
      console.error("Anthropic error (draft-advisor):", errText);
      return NextResponse.json({ error: "Oracle is silent — try again" }, { status: 502 });
    }

    const resData = await anthropicRes.json();
    const advice: string = resData.content?.[0]?.text ?? "";
    if (!advice) return NextResponse.json({ error: "Oracle returned no advice" }, { status: 500 });

    return NextResponse.json({ advice, round: currentRound });
  } catch (err) {
    console.error("Draft advisor error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
