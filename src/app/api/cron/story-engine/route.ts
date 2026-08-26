/**
 * Story Engine weekly recompute (Phase 2).
 * POST { leagueId, week, dryRun? } with the x-cron-secret header.
 * Recomputes the league's Legend state from finalized results. Writes only to
 * character_legend, and only if that league has story_engine_enabled = true.
 * `dryRun: true` computes and returns the would-be state without writing.
 *
 * The automatic post-scoring hook (into finalize-week) is wired in a later step;
 * for now this route makes the engine invokable + testable.
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { recomputeLeagueLegends } from "@/lib/story-engine/engine";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("x-cron-secret") !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    leagueId?: string;
    week?: number | string;
    dryRun?: boolean;
  };
  const leagueId = body.leagueId;
  const week = parseInt(String(body.week ?? ""));
  const dryRun = body.dryRun === true;
  if (!leagueId || !week || week < 1 || week > 25) {
    return NextResponse.json({ error: "leagueId and a valid week (1-25) are required" }, { status: 400 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return NextResponse.json({ error: "Supabase service credentials not configured" }, { status: 500 });
  }
  const admin = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    const result = await recomputeLeagueLegends(admin, leagueId, week, { dryRun });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
