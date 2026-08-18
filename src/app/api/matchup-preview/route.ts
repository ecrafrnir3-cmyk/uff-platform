import { checkRateLimit } from "@/lib/rate-limit";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { TOKEN_NAMES } from "@/lib/token-names";
import { getRecord, CompletedMatchupRow } from "@/lib/get-record";

interface MatchupDbRow {
  id: string;
  member_id: string;
  week: number;
  points: number;
  projected: number | null;
  is_complete: boolean;
  league_members: { team_name: string; faction: string | null } | null;
}

interface TokenRow {
  member_id: string;
  token_id: number;
  status: string;
}

export async function POST(req: NextRequest) {
  try {
    const { matchup_id, league_id } = await req.json();
    if (!matchup_id || !league_id) {
      return NextResponse.json({ error: "Missing matchup_id or league_id" }, { status: 400 });
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { data: me } = await supabase
      .from("league_members")
      .select("id")
      .eq("league_id", league_id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!me) return NextResponse.json({ error: "Not a member" }, { status: 403 });

    const rl = checkRateLimit(`${user.id}:matchup-preview`, 5);
    if (!rl.allowed) return NextResponse.json({ error: "Rate limit exceeded — try again in a minute." }, { status: 429 });

    // Fetch matchup rows
    const { data: rows, error: rowsErr } = await supabase
      .from("uff_matchups")
      .select("id, member_id, week, points, projected, is_complete, league_members(team_name, faction)")
      .eq("matchup_id", matchup_id)
      .eq("league_id", league_id)
      .returns<MatchupDbRow[]>();

    if (rowsErr || !rows || rows.length < 2) {
      return NextResponse.json({ error: "Matchup not found" }, { status: 404 });
    }

    if (rows.every((r) => r.is_complete)) {
      return NextResponse.json({ error: "Matchup already complete — use the Oracle recap instead" }, { status: 400 });
    }

    const [a, b] = rows;
    const week = a.week;

    // Fetch tokens for both members this week
    const { data: tokenRows } = await supabase
      .from("weekly_token_assignments")
      .select("member_id, token_id, status")
      .in("member_id", [a.member_id, b.member_id])
      .eq("week", week)
      .eq("league_id", league_id)
      .returns<TokenRow[]>();

    const tokenMap: Record<string, { token_id: number; status: string }> = {};
    for (const t of (tokenRows ?? [])) tokenMap[t.member_id] = t;

    // Compute season records
    const { data: allMatchups } = await supabase
      .from("uff_matchups")
      .select("matchup_id, member_id, points")
      .eq("league_id", league_id)
      .eq("is_complete", true)
      .returns<CompletedMatchupRow[]>();

    const completedRows = allMatchups ?? [];
    const recA = getRecord(a.member_id, completedRows);
    const recB = getRecord(b.member_id, completedRows);

    // Weekly tokens are secret pre-lock. A member sees only their own token here;
    // the opponent's is revealed ONLY via Recon (token 9) — that's its exclusive power.
    const callerInMatchup = rows.some((r) => r.member_id === me.id);
    const callerToken = tokenMap[me.id];
    const callerHasRecon = callerInMatchup && callerToken?.token_id === 9 && callerToken.status === "pending";

    const formatTeam = (row: MatchupDbRow, rec: { wins: number; losses: number }) => {
      const name = row.league_members?.team_name ?? "Unknown";
      const faction = row.league_members?.faction ?? "unknown";
      const token = tokenMap[row.member_id];
      const isCallerRow = row.member_id === me.id;
      const tokenVisible = isCallerRow || callerHasRecon;
      const tokenStr = !tokenVisible
        ? "Token: shrouded from the Oracle's sight"
        : token
          ? `Token: ${TOKEN_NAMES[token.token_id] ?? `#${token.token_id}`} (${token.status})`
          : "Token: unknown";
      const proj = row.projected != null ? `Projected: ${row.projected.toFixed(1)} pts` : "Projected: TBD";
      return `${name} [${faction}] — ${rec.wins}W-${rec.losses}L — ${proj} — ${tokenStr}`;
    };

    const prompt = `You are the Oracle of Ultimate Fantasy Football — a prophetic voice who delivers pre-game matchup previews with drama and flair.

Week ${week} preview:
- ${formatTeam(a, recA)}
- ${formatTeam(b, recB)}

Write a 3-4 sentence dramatic pre-game preview in the Oracle's voice. Reference both teams by name, their factions (Heroes vs Villains), their records and projected scores, and hint at what tokens might be the deciding factor. Build anticipation — this is a prophecy, not a stat sheet. Under 120 words, pure flowing prose.`;

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
      console.error("Anthropic error (matchup-preview):", errText);
      return NextResponse.json({ error: "Oracle is silent — try again shortly" }, { status: 502 });
    }

    const resData = await anthropicRes.json();
    const preview: string = resData.content?.[0]?.text ?? "";
    if (!preview) return NextResponse.json({ error: "Oracle returned no vision" }, { status: 500 });

    return NextResponse.json({ preview });
  } catch (err) {
    console.error("Matchup preview error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
