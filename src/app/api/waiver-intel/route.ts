import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

interface RosterRow {
  players: { full_name: string; position: string | null } | null;
}

interface PlayerRow {
  id: string;
  full_name: string;
  position: string | null;
  team: string | null;
  status: string | null;
}

export async function POST(req: NextRequest) {
  try {
    const { league_id, player_id } = await req.json();
    if (!league_id || !player_id) {
      return NextResponse.json({ error: "Missing league_id or player_id" }, { status: 400 });
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    // Membership check
    const { data: me } = await supabase
      .from("league_members")
      .select("id")
      .eq("league_id", league_id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!me) return NextResponse.json({ error: "Not a member" }, { status: 403 });

    // Fetch target player
    const { data: player } = await supabase
      .from("players")
      .select("id, full_name, position, team, status")
      .eq("id", player_id)
      .maybeSingle<PlayerRow>();

    if (!player) return NextResponse.json({ error: "Player not found" }, { status: 404 });

    // Fetch my current active roster
    const { data: rosterRaw } = await supabase
      .from("uff_roster_players")
      .select("players(full_name, position)")
      .eq("member_id", me.id)
      .eq("slot", "active")
      .is("dropped_at", null)
      .returns<RosterRow[]>();

    const rosterPlayers = (rosterRaw ?? []).map((r) => r.players).filter(Boolean);

    // Summarize roster by position
    const byPos: Record<string, string[]> = {};
    for (const rp of rosterPlayers) {
      if (!rp) continue;
      const pos = rp.position ?? "UNK";
      if (!byPos[pos]) byPos[pos] = [];
      byPos[pos].push(rp.full_name);
    }
    const rosterStr = Object.entries(byPos)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([pos, names]) => `${pos}: ${names.join(", ")}`)
      .join(" | ") || "empty roster";

    const statusStr = player.status && player.status !== "Active"
      ? ` — ⚠️ ${player.status}`
      : "";

    const prompt = `Fantasy football analyst. Give exactly 1-2 sentences on whether to add this waiver wire player.

Target: ${player.full_name} (${player.position ?? "?"}, ${player.team ?? "FA"})${statusStr}
My roster: ${rosterStr}

Is this player worth adding given my roster needs? Be direct and specific. 1-2 sentences only.`;

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
        max_tokens: 120,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!anthropicRes.ok) {
      console.error("Anthropic error (waiver-intel):", await anthropicRes.text());
      return NextResponse.json({ error: "Oracle unavailable" }, { status: 502 });
    }

    const resData = await anthropicRes.json();
    const intel: string = resData.content?.[0]?.text?.trim() ?? "";
    if (!intel) return NextResponse.json({ error: "No intel returned" }, { status: 500 });

    return NextResponse.json({ intel });
  } catch (err) {
    console.error("Waiver intel error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
