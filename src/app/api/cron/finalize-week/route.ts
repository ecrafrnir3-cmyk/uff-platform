import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getCurrentNFLWeek } from "@/lib/nfl-utils";

// Called by GitHub Actions cron every Wednesday at 07:00 UTC —
// safely after Monday Night Football ends (MNF = ~01:00 UTC Tuesday).
// Finalizes all active leagues for the week that just completed.
export async function POST(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json({ error: "Missing env vars" }, { status: 500 });
  }

  // On Wednesday, getCurrentNFLWeek() has already advanced to the new week.
  // We want the week that just finished (the one whose MNF ended Tuesday).
  const currentWeek = getCurrentNFLWeek();
  const weekToFinalize = Math.max(currentWeek - 1, 1);

  const supabase = createClient(supabaseUrl, serviceKey);

  const { data, error } = await supabase.rpc("finalize_all_active_leagues", {
    p_week: weekToFinalize,
  });

  if (error) {
    console.error("finalize_all_active_leagues error:", error);
    return NextResponse.json({ ok: false, error: error.message, week: weekToFinalize }, { status: 500 });
  }

  // Mark this week's tokens as 'used' now that the week is finalized.
  const { data: tokensMarked, error: tokenErr } = await supabase.rpc(
    "mark_week_tokens_used_all",
    { p_week: weekToFinalize }
  );
  if (tokenErr) console.error("mark_week_tokens_used_all error:", tokenErr.message);

  console.log(`Finalized week ${weekToFinalize}:`, data);
  return NextResponse.json({
    ok: true,
    week: weekToFinalize,
    result: data,
    tokens_marked_used: tokensMarked ?? 0,
  });
}
