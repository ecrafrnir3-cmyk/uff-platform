import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { saveScoringSettings, generateSchedule } from "./actions";

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
  searchParams: Promise<{ error?: string; saved?: string; preset?: string }>;
}) {
  const { id: leagueId } = await params;
  const { error, saved, preset } = await searchParams;
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: league } = await supabase
    .from("uff_leagues")
    .select("id, name, commissioner_id, scoring_settings, draft_status")
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
        {saved && (
          <p className="rounded-md border px-3 py-2 text-sm" style={{ borderColor: "#3DDC84", color: "#3DDC84", background: "#0e1a12" }}>
            Saved successfully.
          </p>
        )}
        {validPreset && !saved && (
          <p className="rounded-md border px-3 py-2 text-sm" style={{ borderColor: "#FFD700", color: "#FFD700", background: "#1a1500" }}>
            Previewing <strong>{validPreset}</strong> preset — hit &ldquo;Save Scoring Settings&rdquo; below to apply it.
          </p>
        )}

        {/* Schedule generator */}
        <section className="flex flex-col gap-3 rounded-lg border p-5" style={{ borderColor: "#2a2a40" }}>
          <h2 className="text-lg font-semibold" style={{ color: "#FFD700" }}>Matchup Schedule</h2>
          {scheduleExists ? (
            <p className="text-sm text-zinc-400">
              14-week regular season schedule is generated. &mdash; View it on the{" "}
              <Link href={`/dashboard/league/${leagueId}/matchups`} className="underline" style={{ color: "#0057FF" }}>
                Matchups page
              </Link>.
            </p>
          ) : (
            <>
              <p className="text-sm text-zinc-400">
                Generates a round-robin 14-week regular season. Run this after the draft is complete.
              </p>
              <form action={generateSchedule}>
                <input type="hidden" name="leagueId" value={leagueId} />
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

        {/* Scoring settings */}
        <section className="flex flex-col gap-6">
          <div className="flex flex-col gap-2">
            <h2 className="text-lg font-semibold" style={{ color: "#FFD700" }}>Scoring Settings</h2>
            <p className="text-sm text-zinc-400">
              Keys match Sleeper&rsquo;s stat format exactly — the live scoring engine uses these directly.
            </p>
            <div className="flex flex-wrap gap-2 mt-1">
              <span className="text-xs text-zinc-500 self-center">Presets:</span>
              {(["Full PPR", "Half PPR", "Standard"] as const).map((preset) => (
                <a
                  key={preset}
                  href={`?preset=${encodeURIComponent(preset)}`}
                  className="rounded px-3 py-1 text-xs font-semibold"
                  style={{ background: "#1c1c2b", color: "#8a8a9a" }}
                >
                  {preset}
                </a>
              ))}
              <span className="text-xs text-zinc-600 self-center">(applies preset then save manually)</span>
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
                      <label htmlFor={key} className="text-sm text-zinc-400 flex-1">
                        {label}
                      </label>
                      <input
                        id={key}
                        name={key}
             