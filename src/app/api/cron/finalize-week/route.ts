import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getRawNFLWeek } from "@/lib/nfl-utils";

// Called by GitHub Actions cron every Wednesday at 07:00 UTC —
// safely after Monday Night Football ends (MNF = ~01:00 UTC Tuesday).
// Finalizes all active leagues for the week that just completed.
export async function POST(req: NextRequest) {
  // Fail closed if the secret was never configured — otherwise the comparison
  // below matches a literal "Bearer undefined" header (audit M1).
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
    return NextResponse.json({ error: "Missing env vars" }, { status: 500 });
  }

  // On Wednesday, the raw week has already advanced to the new week.
  // We want the week that just finished (the one whose MNF ended Tuesday).
  // Using the UNCLAMPED week fixes two bugs (audit C5): week 18 is now
  // finalized (raw 19 - 1), and pre-/post-season Wednesdays no-op instead of
  // re-finalizing week 1 or 17.
  const weekToFinalize = getRawNFLWeek() - 1;
  if (weekToFinalize < 1 || weekToFinalize > 18) {
    return NextResponse.json({ ok: true, skipped: "out of season", week: weekToFinalize });
  }

  const supabase = createClient(supabaseUrl, serviceKey);

  const { data, error } = await supabase.rpc("finalize_all_active_leagues", {
    p_week: weekToFinalize,
  });

  if (error) {
    console.error("finalize_all_active_leagues error:", error);
    return NextResponse.json({ ok: false, error: error.message, week: weekToFinalize }, { status: 500 });
  }

  console.log(`Finalized week ${weekToFinalize}:`, data);
  // Note: finalize_all_active_leagues already marks tokens used internally (step 2).
  return NextResponse.json({
    ok: true,
    week: weekToFinalize,
    result: data,
  });
}
