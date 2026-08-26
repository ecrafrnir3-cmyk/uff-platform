/**
 * Story-engine feats (Phase 2b). Detects the stat-line feats a character's
 * roster earns each week from the Sleeper stat line, and persists them to
 * character_feats (so the LP replay never re-fetches external stats).
 *
 * The one feat that needs play-by-play (Ice Water — a 4th-quarter clutch score)
 * is NOT here; the engine derives it as a clutch-win proxy (won by <= 5) during
 * the replay, where it already has the margins.
 *
 * NOTE: Sleeper stat keys should be sanity-checked against a real Week-1 line;
 * detection is defensive (checks alternate key names) but untested vs live data.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

const SLEEPER_BASE = "https://api.sleeper.app/v1";
const FLAG_KEYS = new Set([
  "pts_allow_0",
  "pts_allow_1_6",
  "pts_allow_7_13",
  "pts_allow_14_20",
  "pts_allow_21_27",
  "pts_allow_28_34",
  "pts_allow_35p",
]);

/** Fantasy score for one stat line under a league's scoring settings (mirrors score-matchups). */
export function calcScore(stats: Record<string, number>, settings: Record<string, number>): number {
  let score = 0;
  for (const [key, mult] of Object.entries(settings)) {
    const val = stats[key];
    if (val == null || val === 0) continue;
    score += FLAG_KEYS.has(key) ? mult : val * mult;
  }
  return Math.round(score * 100) / 100;
}

export const FEAT_ATTR: Record<string, string> = {
  explosion: "STRIKE",
  stonewall: "GUARD",
  breakaway: "BURST",
  twist_of_fate: "OMEN",
  ice_water: "NERVE",
};

const g = (s: Record<string, number>, ...keys: string[]) => {
  for (const k of keys) if (s[k] != null) return s[k];
  return 0;
};

/** Which stat feats a member earns from their starters this week (deduped; one of each at most). */
export function detectStatFeats(
  starters: Record<string, number>[],
  settings: Record<string, number>,
): { feat: string; attr: string }[] {
  let explosion = false,
    stonewall = false,
    breakaway = false,
    twist = false;
  for (const s of starters) {
    const passTd = g(s, "pass_td");
    const scrimmage = g(s, "rush_yd") + g(s, "rec_yd");
    const sack = g(s, "sack", "def_sack");
    const defTd = g(s, "def_td") + g(s, "def_st_td") + g(s, "st_td");
    const ff = g(s, "ff", "def_ff", "def_st_ff");
    const fumRec = g(s, "fum_rec", "def_fum_rec", "def_st_fum_rec");
    const dInt = g(s, "int", "def_int");
    const retTd = g(s, "kr_td") + g(s, "pr_td");
    const pts = calcScore(s, settings);

    if (passTd >= 3 || pts >= 30) explosion = true;
    if (sack >= 3 || defTd >= 1 || g(s, "blk_kick") >= 1) stonewall = true;
    if (scrimmage >= 150) breakaway = true;
    if (ff >= 1 || fumRec >= 1 || dInt >= 1 || defTd >= 1 || retTd >= 1) twist = true;
  }
  const out: { feat: string; attr: string }[] = [];
  if (explosion) out.push({ feat: "explosion", attr: "STRIKE" });
  if (stonewall) out.push({ feat: "stonewall", attr: "GUARD" });
  if (breakaway) out.push({ feat: "breakaway", attr: "BURST" });
  if (twist) out.push({ feat: "twist_of_fate", attr: "OMEN" });
  return out;
}

/**
 * Compute + persist a league's stat feats for one week (idempotent: replaces the
 * week's rows). Fetches the Sleeper stat line and each member's saved starters.
 */
export async function computeWeekFeats(
  admin: SupabaseClient,
  leagueId: string,
  week: number,
): Promise<{ feats: number }> {
  const { data: lg } = await admin.from("uff_leagues").select("season, scoring_settings").eq("id", leagueId).maybeSingle();
  const season = (lg as { season?: string } | null)?.season ?? "2026";
  const settings = ((lg as { scoring_settings?: Record<string, number> } | null)?.scoring_settings ?? {}) as Record<string, number>;

  const res = await fetch(`${SLEEPER_BASE}/stats/nfl/${season}/${week}?season_type=regular`);
  if (!res.ok) throw new Error(`Sleeper stats ${res.status}`);
  const allStats = (await res.json()) as Record<string, Record<string, number>>;

  const { data: members } = await admin.from("league_members").select("id, character_id").eq("league_id", leagueId);
  const memberChar = new Map<string, number>();
  for (const m of (members ?? []) as { id: string; character_id: number | null }[]) {
    if (m.character_id != null) memberChar.set(m.id, m.character_id);
  }
  if (memberChar.size === 0) return { feats: 0 };

  const { data: lineups } = await admin
    .from("uff_lineups")
    .select("member_id, player_id")
    .in("member_id", [...memberChar.keys()])
    .eq("week", week);
  const startersByMember = new Map<string, string[]>();
  for (const l of (lineups ?? []) as { member_id: string; player_id: string }[]) {
    const arr = startersByMember.get(l.member_id) ?? [];
    arr.push(l.player_id);
    startersByMember.set(l.member_id, arr);
  }

  const rows: { league_id: string; character_id: number; week: number; feat: string; attr: string }[] = [];
  for (const [memberId, cid] of memberChar) {
    const ids = startersByMember.get(memberId) ?? [];
    if (ids.length === 0) continue;
    const lines = ids.map((id) => allStats[id] ?? {});
    for (const f of detectStatFeats(lines, settings)) {
      rows.push({ league_id: leagueId, character_id: cid, week, feat: f.feat, attr: f.attr });
    }
  }

  await admin.from("character_feats").delete().eq("league_id", leagueId).eq("week", week);
  if (rows.length) {
    const { error } = await admin.from("character_feats").insert(rows);
    if (error) throw new Error(`character_feats insert: ${error.message}`);
  }
  return { feats: rows.length };
}
