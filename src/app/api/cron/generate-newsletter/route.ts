import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getRawNFLWeek } from "@/lib/nfl-utils";
import { sendEmail, getAllUserEmails, newsletterHtml } from "@/lib/email";
import { createNotification } from "@/lib/notifications";
import {
  buildNewsletterPrompt,
  newsletterProblem,
  newsletterRequest,
  readNewsletterReply,
  type NewsletterMatchupRow as MatchupDbRow,
} from "@/lib/ai-prompts/newsletter";

// ─── Called by GitHub Actions every Wednesday at 07:30 UTC ──────────────────
// Fires 30 minutes after finalize-week (07:00 UTC) to ensure all matchups
// are marked complete and all records are settled before newsletter generation.

interface LeagueRow { id: string; name: string; }

interface SupabaseClient {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from: (table: string) => any;
}

async function generateLeagueNewsletter(
  supabase: SupabaseClient,
  league: LeagueRow,
  week: number,
): Promise<string> {
  // 1. Fetch this week's matchup rows (must be complete)
  const { data: weekRows } = await supabase
    .from("uff_matchups")
    .select("matchup_id, member_id, points, token_bonus, is_complete, league_members(team_name, faction)")
    .eq("league_id", league.id)
    .eq("week", week);

  const weekMatchups = (weekRows ?? []) as MatchupDbRow[];

  // Only generate if at least one complete matchup exists
  const hasComplete = weekMatchups.some((r) => r.is_complete);
  if (!hasComplete || weekMatchups.length < 2) {
    throw new Error(`No complete matchups found for league ${league.id} week ${week}`);
  }

  // 2. Fetch all-time completed rows for standings
  const { data: allRows } = await supabase
    .from("uff_matchups")
    .select("matchup_id, member_id, points, token_bonus, is_complete, league_members(team_name, faction)")
    .eq("league_id", league.id)
    .eq("is_complete", true);

  const allCompleted = (allRows ?? []) as MatchupDbRow[];

  // 3. Fetch weekly tokens for all members
  const memberIds = [...new Set(weekMatchups.map((r) => r.member_id))];
  const { data: tokenRows } = await supabase
    .from("weekly_token_assignments")
    .select("member_id, token_id, status")
    .eq("league_id", league.id)
    .eq("week", week)
    .in("member_id", memberIds);

  // 4-7. Pairs, notable stats, faction war, standings and the prompt are built in
  // @/lib/ai-prompts/newsletter from exactly these rows.
  const prompt = buildNewsletterPrompt({ league, week, weekMatchups, allCompleted, tokenRows });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");

  const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify(newsletterRequest(prompt)),
  });

  if (!anthropicRes.ok) {
    const errText = await anthropicRes.text();
    throw new Error(`Anthropic API error: ${errText}`);
  }

  const resData = await anthropicRes.json();
  const content: string = readNewsletterReply(resData);

  // Empty, cut off by max_tokens, or not ending a sentence: never stored, never mailed (the
  // reasons and the two checks are documented in @/lib/ai-prompts/newsletter).
  const problem = newsletterProblem(resData, content);
  if (problem) throw new Error(problem);

  return content;
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
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
  const apiKey      = process.env.ANTHROPIC_API_KEY;

  if (!supabaseUrl || !serviceKey || !apiKey) {
    return NextResponse.json({ error: "Missing env vars" }, { status: 500 });
  }

  // Wednesday morning: the raw week has already advanced, so the finalized week
  // is raw - 1. Unclamped so week 18 gets a newsletter and off-season
  // Wednesdays no-op instead of regenerating + re-emailing week 17 forever
  // (audit C5).
  // Operator overrides, all CRON_SECRET-protected like the rest of the route.
  //   ?week=N     regenerate a specific week instead of the one just finalized
  //   ?force=1    bypass the idempotency guard (otherwise an existing week is skipped)
  //   ?noEmail=1  write the newsletter but do NOT mail the league
  // Added 2026-09-30 to repair the truncated week-3 newsletter. The default path is
  // unchanged: no params = exactly the old behaviour, so the Wednesday cron is safe.
  // noEmail matters — the members had already received the broken one, and a silent
  // second send is not a decision this route should make on its own.
  const qp        = req.nextUrl.searchParams;
  const weekParam = parseInt(qp.get("week") ?? "");
  const force     = qp.get("force") === "1";
  const noEmail   = qp.get("noEmail") === "1";
  // ?emailOnly=1 — mail the newsletter ALREADY STORED for this week, without
  // regenerating. This is the repair path for a week whose first send went out
  // broken: regenerating would write different prose than the copy people can
  // already read in the app, so the email would not match the record. It also
  // skips the in-app/push notifications, which fired on the original send.
  const emailOnly = qp.get("emailOnly") === "1";

  const week = Number.isFinite(weekParam) && weekParam > 0 ? weekParam : getRawNFLWeek() - 1;
  if (week < 1 || week > 18) {
    return NextResponse.json({ ok: true, skipped: "out of season", week, results: [] });
  }

  const supabase = createClient(supabaseUrl, serviceKey);

  // Fetch all leagues with completed drafts
  const { data: leagues, error: leagueErr } = await supabase
    .from("uff_leagues")
    .select("id, name")
    .eq("draft_status", "completed");

  if (leagueErr || !leagues) {
    console.error("Failed to fetch leagues:", leagueErr);
    return NextResponse.json({ error: "Failed to fetch leagues" }, { status: 500 });
  }

  if (leagues.length === 0) {
    return NextResponse.json({ ok: true, week, message: "No active leagues", results: [] });
  }

  const results: { league_id: string; name: string; ok: boolean; error?: string }[] = [];

  for (const league of leagues) {
    try {
      // Idempotency guard: if this league+week newsletter already exists, it
      // was generated AND emailed on a previous run — never regenerate (fresh
      // Anthropic spend) or re-email members (audit C5).
      const { data: existing } = await supabase
        .from("league_newsletters")
        .select("id, content")
        .eq("league_id", league.id)
        .eq("week", week)
        .maybeSingle();
      if (emailOnly) {
        if (!existing?.content) {
          results.push({
            league_id: league.id, name: league.name, ok: false,
            error: `emailOnly: no stored newsletter for week ${week}`,
          });
          continue;
        }
      } else if (existing && !force) {
        results.push({ league_id: league.id, name: league.name, ok: true });
        continue;
      }

      const content = emailOnly
        ? (existing!.content as string)
        : await generateLeagueNewsletter(supabase, league, week);

      // Upsert — if newsletter already exists for this league+week, overwrite it.
      // Skipped entirely on emailOnly: the stored copy is the thing being sent, and
      // rewriting it would change generated_at for a row that did not change.
      const { error: upsertErr } = emailOnly ? { error: null } : await supabase
        .from("league_newsletters")
        .upsert(
          { league_id: league.id, week, content, generated_at: new Date().toISOString() },
          { onConflict: "league_id,week" },
        );

      if (upsertErr) throw new Error(`Upsert failed: ${upsertErr.message}`);

      // ── Email newsletter to all league members ──────────────────────────────
      if (noEmail) {
        console.log(`newsletter: week ${week} written for ${league.name}, email suppressed (noEmail=1)`);
      } else
      try {
        const { data: members } = await supabase
          .from("league_members")
          .select("user_id")
          .eq("league_id", league.id);

        if (members && members.length > 0) {
          const allEmails = await getAllUserEmails();
          const toAddresses = members
            .map((m: { user_id: string }) => allEmails[m.user_id])
            .filter(Boolean) as string[];

          if (toAddresses.length > 0) {
            // Send individually so each recipient doesn't see others' emails
            await Promise.all(
              toAddresses.map((email) =>
                sendEmail({
                  to: email,
                  priority: "low",
                  subject: `${league.name} · Week ${week} Newsletter${emailOnly ? " (corrected)" : ""}`,
                  html: newsletterHtml({
                    leagueId: league.id,
                    leagueName: league.name,
                    week,
                    content,
                  }),
                })
              )
            );
            console.log(`Newsletter emailed to ${toAddresses.length} members: ${league.name}`);
          }
        }
      } catch (emailErr) {
        // Email failure must not abort the cron — newsletter is already saved to DB
        console.error(`Newsletter email failed for ${league.name}:`, emailErr);
      }

      // In-app + push notification per member. Sits inside the idempotency
      // guard above, so it fires exactly once per league+week — same
      // double-send protection the emails get. createNotification never throws.
      // Skipped on emailOnly: those notifications fired on the original send, and
      // a second bell for the same week would read as a second newsletter.
      if (emailOnly) {
        console.log(`newsletter: week ${week} re-sent for ${league.name}, notifications skipped (emailOnly=1)`);
      } else
      try {
        const { data: notifMembers } = await supabase
          .from("league_members")
          .select("user_id")
          .eq("league_id", league.id);
        if (notifMembers && notifMembers.length > 0) {
          await Promise.all(
            notifMembers.map((m: { user_id: string }) =>
              createNotification({
                leagueId: league.id,
                userId: m.user_id,
                type: "newsletter",
                title: `📰 Week ${week} Newsletter`,
                body: `The ${league.name} weekly newsletter is out — tap to read it.`,
              })
            )
          );
        }
      } catch (notifErr) {
        console.error(`Newsletter notifications failed for ${league.name}:`, notifErr);
      }

      console.log(`Newsletter generated: ${league.name} week ${week}`);
      results.push({ league_id: league.id, name: league.name, ok: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Newsletter failed for ${league.name}:`, msg);
      results.push({ league_id: league.id, name: league.name, ok: false, error: msg });
    }
  }

  // 200 = all leagues ok, 207 = partial failure, 500 = EVERY league failed —
  // a total failure (e.g. revoked API key) must turn the workflow red instead
  // of hiding behind an accepted 207 (audit M3).
  const allOk = results.every((r) => r.ok);
  const anyOk = results.some((r) => r.ok);
  return NextResponse.json(
    { ok: allOk, week, results },
    { status: allOk ? 200 : anyOk ? 207 : 500 },
  );
}
