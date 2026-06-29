import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { saveScoringSettings, generateSchedule, extendSchedule, saveLeagueSettings, seedPlayoffs, forceFinalize, syncPlayers, processWaivers } from "./actions";
import { approveTrade, vetoTrade } from "../trade-actions";
import { getCurrentNFLWeek } from "@/lib/nfl-utils";

const PRESETS = {
  "Full PPR": {
    pass_td: 4, pass_yd: 0.04, pass_int: -2, pass_2pt: 2,
    rush_td: 6, rush_yd: 0.1, rush_2pt: 2,
    rec: 1, rec_td: 6, rec_yd: 0.1, rec_2pt: 2,
    fum_lost: -2, ret_td: 6,
    def_td: 6, sack: 1, def_int: 2, fum_rec: 2, safe: 2, blk_kick: 2,
    pts_allow_0: 10, pts_allow_1_6: 7, pts_allow_7_13: 4, pts_allow_14_20: 1,
    pts_allow_21_27: 0, pts_allow_28_34: -1, pts_allow_35p: -4,
    fgm_0_19: 3, fgm_20_29: 3, fgm_30_39: 3, fgm_40_49: 4, fgm_50p: 5, pat_md: 1, pat_ms: -1,
  },
  "Half PPR": { rec: 0.5 },
  "Standard": { rec: 0 },
};

const SCORING_GROUPS = [
  {
    label: "Passing",
    fields: [
      { key: "pass_td", label: "Passing TD" },
      { key: "pass_yd", label: "Passing yards (per yd)" },
      { key: "pass_int", label: "Interception thrown" },
      { key: "pass_2pt", label: "2-pt conversion (pass)" },
    ],
  },
  {
    label: "Rushing",
    fields: [
      { key: "rush_td", label: "Rushing TD" },
      { key: "rush_yd", label: "Rushing yards (per yd)" },
      { key: "rush_2pt", label: "2-pt conversion (rush)" },
    ],
  },
  {
    label: "Receiving",
    fields: [
      { key: "rec", label: "Reception (PPR)" },
      { key: "rec_td", label: "Receiving TD" },
      { key: "rec_yd", label: "Receiving yards (per yd)" },
      { key: "rec_2pt", label: "2-pt conversion (rec)" },
    ],
  },
  {
    label: "Miscellaneous",
    fields: [
      { key: "fum_lost", label: "Fumble lost" },
      { key: "ret_td", label: "Return TD" },
    ],
  },
  {
    label: "Defense / Special Teams",
    fields: [
      { key: "def_td", label: "Defensive TD" },
      { key: "sack", label: "Sack" },
      { key: "def_int", label: "Interception" },
      { key: "fum_rec", label: "Fumble recovery" },
      { key: "safe", label: "Safety" },
      { key: "blk_kick", label: "Blocked kick" },
      { key: "pts_allow_0", label: "Points allowed: 0" },
      { key: "pts_allow_1_6", label: "Points allowed: 1–6" },
      { key: "pts_allow_7_13", label: "Points allowed: 7–13" },
      { key: "pts_allow_14_20", label: "Points allowed: 14–20" },
      { key: "pts_allow_21_27", label: "Points allowed: 21–27" },
      { key: "pts_allow_28_34", label: "Points allowed: 28–34" },
      { key: "pts_allow_35p", label: "Points allowed: 35+" },
    ],
  },
  {
    label: "Kicker",
    fields: [
      { key: "fgm_0_19", label: "FG made: 0–19 yds" },
      { key: "fgm_20_29", label: "FG made: 20–29 yds" },
      { key: "fgm_30_39", label: "FG made: 30–39 yds" },
      { key: "fgm_40_49", label: "FG made: 40–49 yds" },
      { key: "fgm_50p", label: "FG made: 50+ yds" },
      { key: "pat_md", label: "PAT made" },
      { key: "pat_ms", label: "PAT missed" },
    ],
  },
];

export default async function SettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; saved?: string; preset?: string; claims?: string; approved?: string; vetoed?: string }>;
}) {
  const { id: leagueId } = await params;
  const { error, saved, preset, claims, approved, vetoed } = await searchParams;
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: league } = await supabase
    .from("uff_leagues")
    .select("id, name, commissioner_id, scoring_settings, draft_status, season, season_weeks, playoff_teams, playoff_start_week, championship_week, median_scoring, trade_deadline_week, faab_budget, commissioner_review, max_adds_per_week, max_adds_per_season")
    .eq("id", leagueId)
    .maybeSingle();

  if (!league) redirect("/dashboard?error=" + encodeURIComponent("League not found."));
  if (league.commissioner_id !== user.id) {
    redirect(`/dashboard/league/${leagueId}?error=` + encodeURIComponent("Only the commissioner can access settings."));
  }

  const { data: scheduleCheck } = await supabase
    .from("uff_matchups")
    .select("id")
    .eq("league_id", leagueId)
    .limit(1);

  const scheduleExists = (scheduleCheck?.length ?? 0) > 0;
  const currentNFLWeek = getCurrentNFLWeek();

  // Pending commissioner-review trades
  interface PendingReviewTrade {
    id: string;
    proposer_id: string;
    receiver_id: string;
    proposer_player_ids: string[];
    receiver_player_ids: string[];
    created_at: string;
    updated_at: string;
  }
  const { data: reviewTradeRows } = await supabase
    .from("uff_trades")
    .select("id, proposer_id, receiver_id, proposer_player_ids, receiver_player_ids, created_at, updated_at")
    .eq("league_id", leagueId)
    .eq("status", "pending_review")
    .order("updated_at", { ascending: false })
    .returns<PendingReviewTrade[]>();
  const reviewTrades = reviewTradeRows ?? [];

  let reviewPlayerNames: Record<string, string> = {};
  let reviewMemberNames: Record<string, string> = {};
  if (reviewTrades.length > 0) {
    const allPlayerIds = [...new Set(reviewTrades.flatMap(t => [...t.proposer_player_ids, ...t.receiver_player_ids]))];
    const allMemberIds = [...new Set(reviewTrades.flatMap(t => [t.proposer_id, t.receiver_id]))];
    const [{ data: rPlayers }, { data: rMembers }] = await Promise.all([
      supabase.from("players").select("id, full_name").in("id", allPlayerIds).returns<{ id: string; full_name: string }[]>(),
      supabase.from("league_members").select("id, team_name").in("id", allMemberIds).returns<{ id: string; team_name: string }[]>(),
    ]);
    for (const p of rPlayers ?? []) reviewPlayerNames[p.id] = p.full_name;
    for (const m of rMembers ?? []) reviewMemberNames[m.id] = m.team_name;
  }
  const savedSettings: Record<string, number> = league.scoring_settings ?? {};

  // Apply preset if requested via ?preset= query param
  const validPreset = preset === "Full PPR" || preset === "Half PPR" || preset === "Standard" ? preset : null;
  const presetValues: Record<string, number> = validPreset
    ? { ...PRESETS["Full PPR"], ...(PRESETS[validPreset] ?? {}) }
    : {};
  const settings: Record<string, number> = validPreset
    ? { ...savedSettings, ...presetValues }
    : savedSettings;

  return (
    <div className="min-h-screen px-6 py-12 sm:px-12" style={{ background: "#0d0d1a", color: "#f4f4f8" }}>
      <main className="mx-auto flex max-w-2xl flex-col gap-8">
        <header className="flex flex-col gap-2">
          <Link href={`/dashboard/league/${leagueId}`} className="text-sm underline" style={{ color: "#0057FF" }}>
            &larr; Back to {league.name}
          </Link>
          <p className="text-sm uppercase tracking-[0.3em]" style={{ color: "#FFD700" }}>
            Commissioner Settings
          </p>
          <h1 className="text-3xl sm:text-4xl" style={{ fontFamily: "var(--font-display, sans-serif)", color: "#0057FF" }}>
            League Settings
          </h1>
        </header>

        {error && (
          <p className="rounded-md border px-3 py-2 text-sm" style={{ borderColor: "#CC0000", color: "#ff8a8a", background: "#1a0e16" }}>
            {decodeURIComponent(error)}
          </p>
        )}
        {saved && !claims && (
          <p className="rounded-md border px-3 py-2 text-sm" style={{ borderColor: "#3DDC84", color: "#3DDC84", background: "#0e1a12" }}>
            Saved successfully.
          </p>
        )}
        {saved && claims !== undefined && (
          <p className="rounded-md border px-3 py-2 text-sm" style={{ borderColor: "#FFD700", color: "#FFD700", background: "#1a1500" }}>
            Waivers processed — <strong>{claims}</strong> claim{claims === "1" ? "" : "s"} awarded.
          </p>
        )}
        {approved && (
          <p className="rounded-md border px-3 py-2 text-sm" style={{ borderColor: "#3DDC84", color: "#3DDC84", background: "#0e1a12" }}>
            Trade approved — rosters updated!
          </p>
        )}
        {vetoed && (
          <p className="rounded-md border px-3 py-2 text-sm" style={{ borderColor: "#CC0000", color: "#ff8a8a", background: "#1a0e16" }}>
            Trade vetoed.
          </p>
        )}
        {validPreset && !saved && (
          <p className="rounded-md border px-3 py-2 text-sm" style={{ borderColor: "#FFD700", color: "#FFD700", background: "#1a1500" }}>
            Previewing <strong>{validPreset}</strong> preset — hit &ldquo;Save Scoring Settings&rdquo; below to apply it.
          </p>
        )}

        {/* Schedule generator / extender */}
        <section className="flex flex-col gap-3 rounded-lg border p-5" style={{ borderColor: "#2a2a40" }}>
          <h2 className="text-lg font-semibold" style={{ color: "#FFD700" }}>Matchup Schedule</h2>
          {scheduleExists ? (
            <>
              <p className="text-sm text-white">
                {league.season_weeks ?? 14}-week regular season schedule is generated. &mdash; View it on the{" "}
                <Link href={`/dashboard/league/${leagueId}/matchups`} className="underline" style={{ color: "#0057FF" }}>
                  Matchups page
                </Link>.
              </p>
              {(league.season_weeks ?? 14) < 18 && (
                <>
                  <p className="text-sm" style={{ color: "#8888aa" }}>
                    Extend the regular season by adding weeks. Completed weeks are preserved — only new empty weeks are added.
                  </p>
                  <form action={extendSchedule} className="flex items-center gap-3 flex-wrap">
                    <input type="hidden" name="leagueId" value={leagueId} />
                    <label htmlFor="new-weeks" className="text-sm text-white shrink-0">Extend to week</label>
                    <select
                      id="new-weeks"
                      name="new_weeks"
                      defaultValue={String((league.season_weeks ?? 14) + 1)}
                      className="rounded-md px-3 py-2 text-sm font-medium"
                      style={{ background: "#1c1c2b", color: "#fff", border: "1px solid #2a2a40" }}
                    >
                      {Array.from({ length: 18 - (league.season_weeks ?? 14) }, (_, i) => (league.season_weeks ?? 14) + i + 1).map((w) => (
                        <option key={w} value={w}>Week {w}</option>
                      ))}
                    </select>
                    <button
                      type="submit"
                      className="rounded-md px-4 py-2 text-sm font-semibold"
                      style={{ background: "#FFD700", color: "#0d0d1a" }}
                    >
                      Extend Schedule
                    </button>
                  </form>
                </>
              )}
            </>
          ) : (
            <>
              <p className="text-sm text-white">
                Generates a round-robin regular season schedule. Choose how many weeks to play, then run after the draft is complete. The NFL regular season runs 18 weeks (Week 1 starts Sept 9, 2026).
              </p>
              <form action={generateSchedule} className="flex items-center gap-3 flex-wrap">
                <input type="hidden" name="leagueId" value={leagueId} />
                <label htmlFor="season-weeks" className="text-sm text-white shrink-0">Season length</label>
                <select
                  id="season-weeks"
                  name="season_weeks"
                  defaultValue="18"
                  className="rounded-md px-3 py-2 text-sm font-medium"
                  style={{ background: "#1c1c2b", color: "#fff", border: "1px solid #2a2a40" }}
                >
                  {[13, 14, 15, 16, 17, 18].map((w) => (
                    <option key={w} value={w}>{w} weeks</option>
                  ))}
                </select>
                <button
                  type="submit"
                  className="rounded-md px-4 py-2 text-sm font-semibold"
                  style={{ background: "#FFD700", color: "#0d0d1a" }}
                >
                  Generate Schedule
                </button>
              </form>
            </>
          )}
        </section>

        {/* Playoff & league settings */}
        <section className="flex flex-col gap-3 rounded-lg border p-5" style={{ borderColor: "#2a2a40" }}>
          <h2 className="text-lg font-semibold" style={{ color: "#FFD700" }}>Playoffs &amp; League Rules</h2>
          <p className="text-sm" style={{ color: "#8888aa" }}>
            Configure playoff structure, championship week, and scoring rules. Changes take effect immediately.
          </p>
          <form action={saveLeagueSettings} className="flex flex-col gap-4">
            <input type="hidden" name="leagueId" value={leagueId} />

            {/* Playoff teams */}
            <div className="flex items-center justify-between gap-4">
              <div className="flex flex-col gap-0.5">
                <label className="text-sm font-medium text-white">Playoff Teams</label>
                <span className="text-xs" style={{ color: "#6b6b8a" }}>How many teams qualify for playoffs</span>
              </div>
              <select
                name="playoff_teams"
                defaultValue={String(league.playoff_teams ?? 6)}
                className="rounded-md px-3 py-2 text-sm font-medium"
                style={{ background: "#1c1c2b", color: "#fff", border: "1px solid #2a2a40" }}
              >
                {[4, 6, 8].map((n) => <option key={n} value={n}>{n} teams</option>)}
              </select>
            </div>

            {/* Playoff start week */}
            <div className="flex items-center justify-between gap-4">
              <div className="flex flex-col gap-0.5">
                <label className="text-sm font-medium text-white">Playoffs Start Week</label>
                <span className="text-xs" style={{ color: "#6b6b8a" }}>First week of playoff games (wildcard round)</span>
              </div>
              <select
                name="playoff_start_week"
                defaultValue={String(league.playoff_start_week ?? 15)}
                className="rounded-md px-3 py-2 text-sm font-medium"
                style={{ background: "#1c1c2b", color: "#fff", border: "1px solid #2a2a40" }}
              >
                {[14, 15, 16, 17].map((w) => <option key={w} value={w}>Week {w}</option>)}
              </select>
            </div>

            {/* Championship week */}
            <div className="flex items-center justify-between gap-4">
              <div className="flex flex-col gap-0.5">
                <label className="text-sm font-medium text-white">Championship Week</label>
                <span className="text-xs" style={{ color: "#6b6b8a" }}>Final matchup — can be week 17 or 18</span>
              </div>
              <select
                name="championship_week"
                defaultValue={String(league.championship_week ?? 17)}
                className="rounded-md px-3 py-2 text-sm font-medium"
                style={{ background: "#1c1c2b", color: "#fff", border: "1px solid #2a2a40" }}
              >
                {[16, 17, 18].map((w) => <option key={w} value={w}>Week {w}</option>)}
              </select>
            </div>

            {/* Trade deadline */}
            <div className="flex items-center justify-between gap-4">
              <div className="flex flex-col gap-0.5">
                <label className="text-sm font-medium text-white">Trade Deadline</label>
                <span className="text-xs" style={{ color: "#6b6b8a" }}>Trades blocked after this week. Leave blank for no deadline.</span>
              </div>
              <input
                name="trade_deadline_week"
                type="number"
                min={1}
                max={18}
                defaultValue={league.trade_deadline_week ?? ""}
                placeholder="None"
                className="w-24 rounded border px-2 py-1 text-sm text-center tabular-nums"
                style={{ borderColor: "#2a2a40", background: "#15151f", color: "#f4f4f8" }}
              />
            </div>

            {/* Median scoring */}
            <div className="flex items-center justify-between gap-4">
              <div className="flex flex-col gap-0.5">
                <label className="text-sm font-medium text-white">Play Against Median Score</label>
                <span className="text-xs" style={{ color: "#6b6b8a" }}>Each week: bonus W if you beat the league median, bonus L if you don&apos;t</span>
              </div>
              <select
                name="median_scoring"
                defaultValue={league.median_scoring ? "1" : "0"}
                className="rounded-md px-3 py-2 text-sm font-medium"
                style={{ background: "#1c1c2b", color: "#fff", border: "1px solid #2a2a40" }}
              >
                <option value="0">Off</option>
                <option value="1">On</option>
              </select>
            </div>

            {/* FAAB budget */}
            <div className="flex items-center justify-between gap-4">
              <div className="flex flex-col gap-0.5">
                <label className="text-sm font-medium text-white">FAAB Budget</label>
                <span className="text-xs" style={{ color: "#6b6b8a" }}>Free Agent Acquisition Budget per team. 0 = instant free-for-all adds (no bidding).</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-bold" style={{ color: "#FFD700" }}>$</span>
                <input
                  name="faab_budget"
                  type="number"
                  min={0}
                  max={10000}
                  step={1}
                  defaultValue={league.faab_budget ?? 0}
                  className="w-24 rounded border px-2 py-1 text-sm text-center tabular-nums"
                  style={{ borderColor: "#2a2a40", background: "#15151f", color: "#f4f4f8" }}
                />
              </div>
            </div>

            {/* Commissioner trade review */}
            <div className="flex items-center justify-between gap-4">
              <div className="flex flex-col gap-0.5">
                <label className="text-sm font-medium text-white">Commissioner Trade Review</label>
                <span className="text-xs" style={{ color: "#6b6b8a" }}>Accepted trades go to commissioner review before executing. You approve or veto each one.</span>
              </div>
              <select
                name="commissioner_review"
                defaultValue={league.commissioner_review ? "1" : "0"}
                className="rounded-md px-3 py-2 text-sm font-medium"
                style={{ background: "#1c1c2b", color: "#fff", border: "1px solid #2a2a40" }}
              >
                <option value="0">Off</option>
                <option value="1">On</option>
              </select>
            </div>

            {/* Acquisition limits */}
            <div className="flex items-center justify-between gap-4">
              <div className="flex flex-col gap-0.5">
                <label className="text-sm font-medium text-white">Max Adds Per Week</label>
                <span className="text-xs" style={{ color: "#6b6b8a" }}>Max free agent adds a team can make in a single NFL week. 0 = unlimited.</span>
              </div>
              <input
                name="max_adds_per_week"
                type="number"
                min={0}
                max={99}
                defaultValue={league.max_adds_per_week ?? 0}
                className="w-24 rounded border px-2 py-1 text-sm text-center tabular-nums"
                style={{ borderColor: "#2a2a40", background: "#15151f", color: "#f4f4f8" }}
              />
            </div>

            <div className="flex items-center justify-between gap-4">
              <div className="flex flex-col gap-0.5">
                <label className="text-sm font-medium text-white">Max Adds Per Season</label>
                <span className="text-xs" style={{ color: "#6b6b8a" }}>Max total free agent adds across the entire season. 0 = unlimited.</span>
              </div>
              <input
                name="max_adds_per_season"
                type="number"
                min={0}
                max={999}
                defaultValue={league.max_adds_per_season ?? 0}
                className="w-24 rounded border px-2 py-1 text-sm text-center tabular-nums"
                style={{ borderColor: "#2a2a40", background: "#15151f", color: "#f4f4f8" }}
              />
            </div>

            <button
              type="submit"
              className="self-start rounded-md px-4 py-2 text-sm font-semibold"
              style={{ background: "#0057FF", color: "#f4f4f8" }}
            >
              Save League Settings
            </button>
          </form>
        </section>

        {/* Pending trade reviews */}
        {league.commissioner_review && (
          <section className="flex flex-col gap-3 rounded-lg border p-5" style={{ borderColor: "#2a2a40" }}>
            <h2 className="text-lg font-semibold" style={{ color: "#FFD700" }}>Pending Trade Reviews</h2>
            <p className="text-sm" style={{ color: "#8888aa" }}>
              These trades were accepted by both parties and are awaiting your approval.
            </p>
            {reviewTrades.length === 0 ? (
              <p className="text-sm" style={{ color: "#6b6b8a" }}>No trades pending review.</p>
            ) : (
              <div className="flex flex-col gap-4">
                {reviewTrades.map((t) => (
                  <div key={t.id} className="rounded-xl border p-4 flex flex-col gap-3" style={{ borderColor: "#2a2a40", background: "#13132b" }}>
                    <p className="text-sm font-bold" style={{ color: "#f4f4f8" }}>
                      {reviewMemberNames[t.proposer_id] ?? "Team A"} ↔ {reviewMemberNames[t.receiver_id] ?? "Team B"}
                    </p>
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <p className="text-xs font-semibold uppercase mb-1" style={{ color: "#8888aa" }}>
                          {reviewMemberNames[t.proposer_id] ?? "Proposer"} sends
                        </p>
                        <ul className="flex flex-col gap-0.5">
                          {t.proposer_player_ids.map(pid => (
                            <li key={pid} style={{ color: "#3DDC84" }}>{reviewPlayerNames[pid] ?? pid}</li>
                          ))}
                        </ul>
                      </div>
                      <div>
                        <p className="text-xs font-semibold uppercase mb-1" style={{ color: "#8888aa" }}>
                          {reviewMemberNames[t.receiver_id] ?? "Receiver"} sends
                        </p>
                        <ul className="flex flex-col gap-0.5">
                          {t.receiver_player_ids.map(pid => (
                            <li key={pid} style={{ color: "#FFD700" }}>{reviewPlayerNames[pid] ?? pid}</li>
                          ))}
                        </ul>
                      </div>
                    </div>
                    <div className="flex gap-2 flex-wrap">
                      <form action={approveTrade}>
                        <input type="hidden" name="leagueId" value={leagueId} />
                        <input type="hidden" name="tradeId" value={t.id} />
                        <button type="submit" className="rounded-md px-4 py-1.5 text-xs font-bold transition-opacity hover:opacity-90"
                          style={{ background: "#3DDC84", color: "#0d0d1a" }}>
                          ✓ Approve
                        </button>
                      </form>
                      <form action={vetoTrade} className="flex gap-2">
                        <input type="hidden" name="leagueId" value={leagueId} />
                        <input type="hidden" name="tradeId" value={t.id} />
                        <input
                          name="reason"
                          type="text"
                          placeholder="Veto reason (optional)"
                          className="rounded border px-2 py-1 text-xs"
                          style={{ borderColor: "#2a2a40", background: "#15151f", color: "#f4f4f8", width: "180px" }}
                        />
                        <button type="submit" className="rounded-md px-4 py-1.5 text-xs font-bold transition-opacity hover:opacity-90"
                          style={{ background: "#1c1c2b", color: "#CC0000", border: "1px solid rgba(204,0,0,0.3)" }}>
                          ✗ Veto
                        </button>
                      </form>
                    </div>
                    <p className="text-xs" style={{ color: "#6b6b8a" }}>
                      Accepted {new Date(t.updated_at).toLocaleDateString()}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {/* Seed playoffs */}
        {scheduleExists && (
          <section className="flex flex-col gap-3 rounded-lg border p-5" style={{ borderColor: "#2a2a40" }}>
            <h2 className="text-lg font-semibold" style={{ color: "#FFD700" }}>Seed Playoff Bracket</h2>
            <p className="text-sm text-white">
              Seeds all playoff teams by final standings (wins → points for). Run this after the regular season ends.
              Generates the wildcard matchups and sets up the bracket.
            </p>
            <form action={seedPlayoffs}>
              <input type="hidden" name="leagueId" value={leagueId} />
              <button
                type="submit"
                className="rounded-md px-4 py-2 text-sm font-semibold"
                style={{ background: "#FFD700", color: "#0d0d1a" }}
              >
                Seed Playoffs &rarr;
              </button>
            </form>
          </section>
        )}

        {/* Force finalize */}
        <section className="flex flex-col gap-3 rounded-lg border p-5" style={{ borderColor: "#2a2a40" }}>
          <h2 className="text-lg font-semibold" style={{ color: "#FFD700" }}>Force Finalize Week</h2>
          <p className="text-sm text-white">
            Manually finalize a week — marks matchups complete, applies Insurance tokens, awards the high-score
            Power Restore Chip. Use if the Wednesday cron fails. Week {currentNFLWeek} is the current NFL week.
          </p>
          <form action={forceFinalize} className="flex items-center gap-3 flex-wrap">
            <input type="hidden" name="leagueId" value={leagueId} />
            <label htmlFor="finalize-week" className="text-sm text-white shrink-0">Week</label>
            <input
              id="finalize-week"
              name="week"
              type="number"
              min={1}
              max={18}
              defaultValue={currentNFLWeek}
              className="w-20 rounded border px-2 py-1 text-sm text-center tabular-nums"
              style={{ borderColor: "#2a2a40", background: "#15151f", color: "#f4f4f8" }}
            />
            <button
              type="submit"
              className="rounded-md px-4 py-2 text-sm font-semibold"
              style={{ background: "#CC0000", color: "#f4f4f8" }}
            >
              Finalize Week
            </button>
          </form>
        </section>

        {/* Process waivers (only shown when FAAB is enabled) */}
        {(league.faab_budget ?? 0) > 0 && (
          <section className="flex flex-col gap-3 rounded-lg border p-5" style={{ borderColor: "#FFD70044" }}>
            <h2 className="text-lg font-semibold" style={{ color: "#FFD700" }}>Process FAAB Waivers</h2>
            <p className="text-sm text-white">
              Evaluates all pending FAAB bids for the selected week. Highest bidder wins each player,
              FAAB is deducted, and rosters are updated. Losing bids are revealed after processing.
            </p>
            <form action={processWaivers} className="flex items-center gap-3 flex-wrap">
              <input type="hidden" name="leagueId" value={leagueId} />
              <label htmlFor="waiver-week" className="text-sm text-white shrink-0">Week</label>
              <input
                id="waiver-week"
                name="week"
                type="number"
                min={1}
                max={18}
                defaultValue={currentNFLWeek}
                className="w-20 rounded border px-2 py-1 text-sm text-center tabular-nums"
                style={{ borderColor: "#2a2a40", background: "#15151f", color: "#f4f4f8" }}
              />
              <button
                type="submit"
                className="rounded-md px-4 py-2 text-sm font-semibold"
                style={{ background: "#FFD700", color: "#0d0d1a" }}
              >
                Process Waivers
              </button>
            </form>
          </section>
        )}

        {/* Sync player data */}
        <section className="flex flex-col gap-3 rounded-lg border p-5" style={{ borderColor: "#2a2a40" }}>
          <h2 className="text-lg font-semibold" style={{ color: "#FFD700" }}>Sync Player Data</h2>
          <p className="text-sm text-white">
            Pulls the latest NFL roster from Sleeper — updates player names, teams, and injury status.
            Run this when players are traded, cut, or signing status changes during the season.
          </p>
          <form action={syncPlayers}>
            <input type="hidden" name="leagueId" value={leagueId} />
            <button
              type="submit"
              className="rounded-md px-4 py-2 text-sm font-semibold"
              style={{ background: "#1c1c2b", color: "#f4f4f8", border: "1px solid #3DDC84" }}
            >
              Sync Players
            </button>
          </form>
        </section>

        {/* Scoring settings */}
        <section className="flex flex-col gap-6">
          <div className="flex flex-col gap-2">
            <h2 className="text-lg font-semibold" style={{ color: "#FFD700" }}>Scoring Settings</h2>
            <p className="text-sm text-white">
              Keys match Sleeper&rsquo;s stat format exactly — the live scoring engine uses these directly.
            </p>
            <div className="flex flex-wrap gap-2 mt-1">
              <span className="text-xs text-white self-center">Presets:</span>
              {(["Full PPR", "Half PPR", "Standard"] as const).map((preset) => (
                <a
                  key={preset}
                  href={`?preset=${encodeURIComponent(preset)}`}
                  className="rounded px-3 py-1 text-xs font-semibold"
                  style={{ background: "#1c1c2b", color: "#f4f4f8" }}
                >
                  {preset}
                </a>
              ))}
              <span className="text-xs self-center" style={{ color: "#f4f4f8" }}>(applies preset then save manually)</span>
            </div>
          </div>

          <form action={saveScoringSettings} className="flex flex-col gap-6">
            <input type="hidden" name="leagueId" value={leagueId} />

            {SCORING_GROUPS.map((group) => (
              <div key={group.label} className="flex flex-col gap-3 rounded-lg border p-5" style={{ borderColor: "#2a2a40" }}>
                <h3 className="text-sm font-semibold uppercase tracking-wide" style={{ color: "#0057FF" }}>
                  {group.label}
                </h3>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {group.fields.map(({ key, label }) => (
                    <div key={key} className="flex items-center justify-between gap-3">
                      <label htmlFor={key} className="text-sm text-white flex-1">
                        {label}
                      </label>
                      <input
                        id={key}
                        name={key}
                        type="number"
                        step="any"
                        defaultValue={settings[key] ?? ""}
                        className="w-24 rounded border px-2 py-1 text-right text-sm tabular-nums"
                        style={{ borderColor: "#2a2a40", background: "#15151f", color: "#f4f4f8" }}
                      />
                    </div>
                  ))}
                </div>
              </div>
            ))}

            <button
              type="submit"
              className="self-start rounded-md px-4 py-2 text-sm font-semibold"
              style={{ background: "#0057FF", color: "#f4f4f8" }}
            >
              Save Scoring Settings
            </button>
          </form>
        </section>
      </main>
    </div>
  );
}
