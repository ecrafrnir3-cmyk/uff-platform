import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getRawNFLWeek } from "@/lib/nfl-utils";
import { recomputeLeagueLegends } from "@/lib/story-engine/engine";
import { computeWeekFeats } from "@/lib/story-engine/feats";

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
  const target = getRawNFLWeek() - 1;
  if (target < 1 || target > 18) {
    return NextResponse.json({ ok: true, skipped: "out of season", week: target });
  }

  const supabase = createClient(supabaseUrl, serviceKey);

  // Catch-up: finalize EVERY week from 1..target, not just the latest. A single
  // dropped or delayed Wednesday run otherwise permanently skips that week —
  // finalize_all_active_leagues only ever re-selects is_complete=false rows, so a
  // never-finalized week is never revisited and its tokens/standings freeze
  // (audit + this repo's own prior silent-cron incident). Each call is idempotent:
  // the RPC's per-league loop no-ops any week already fully finalized, so
  // re-running 1..target every Wednesday is safe and cheap.
  const perWeek: { week: number; finalized: number; skipped: number }[] = [];
  const weeksFinalized: number[] = [];
  for (let w = 1; w <= target; w++) {
    const { data, error } = await supabase.rpc("finalize_all_active_leagues", { p_week: w });
    if (error) {
      console.error(`finalize_all_active_leagues error (week ${w}):`, error);
      return NextResponse.json({ ok: false, error: error.message, week: w, perWeek }, { status: 500 });
    }
    const finalized = Number((data as { finalized?: number } | null)?.finalized ?? 0);
    const skipped   = Number((data as { skipped?: number } | null)?.skipped ?? 0);
    perWeek.push({ week: w, finalized, skipped });
    if (finalized > 0) weeksFinalized.push(w);
  }
  console.log(`Finalize catch-up 1..${target}:`, JSON.stringify(perWeek));

  // ── Story Engine hook (parallel layer, opted-in leagues only) ────────────
  // Runs AFTER finalize succeeds. Fully isolated: any failure is logged and
  // swallowed so the story layer can never affect the real finalize result,
  // scores, or standings. Computes feats for each week that actually finalized
  // this run (idempotent), then replays legends once through the target week.
  let storyLeagues = 0;
  if (weeksFinalized.length > 0) {
    try {
      const { data: enabled } = await supabase
        .from("uff_leagues")
        .select("id")
        .eq("story_engine_enabled", true);
      for (const lg of (enabled ?? []) as { id: string }[]) {
        try {
          for (const w of weeksFinalized) {
            await computeWeekFeats(supabase, lg.id, w);
          }
          await recomputeLeagueLegends(supabase, lg.id, target);
          storyLeagues++;
        } catch (e) {
          console.error(`story engine failed for league ${lg.id}:`, (e as Error).message);
        }
      }
    } catch (e) {
      console.error("story engine hook failed:", (e as Error).message);
    }
  }

  const totalSkipped = perWeek.reduce((s, p) => s + p.skipped, 0);
  // Note: finalize_all_active_leagues already marks tokens used internally (step 2).
  return NextResponse.json({
    ok: true,
    week: target,
    perWeek,
    weeksFinalized,
    ...(totalSkipped > 0 ? { warning: `${totalSkipped} league-week(s) were skipped during finalize (errored) — investigate` } : {}),
    storyLeagues,
  });
}
