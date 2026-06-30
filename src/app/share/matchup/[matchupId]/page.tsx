import { createAdminClient } from "@/lib/supabase/admin";
import Link from "next/link";
import type { Metadata } from "next";

const HERO_COLOR    = "#0057FF";
const VILLAIN_COLOR = "#CC0000";
const GOLD          = "#FFD700";

function factionColor(faction: "hero" | "villain" | null) {
  if (faction === "hero")    return HERO_COLOR;
  if (faction === "villain") return VILLAIN_COLOR;
  return "#f4f4f8";
}

interface ShareMatchupRow {
  id: string;
  matchup_id: number;
  week: number;
  points: number;
  is_complete: boolean;
  oracle_recap: string | null;
  member_id: string;
  league_id: string;
  league_members: { team_name: string; faction: "hero" | "villain" | null } | null;
}

interface LeagueRow {
  name: string;
  season: string;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ matchupId: string }>;
}): Promise<Metadata> {
  const { matchupId } = await params;
  const admin = createAdminClient();
  const { data: rows } = await admin
    .from("uff_matchups")
    .select("week, points, is_complete, league_members(team_name, faction)")
    .eq("matchup_id", parseInt(matchupId, 10))
    .returns<{ week: number; points: number; is_complete: boolean; league_members: { team_name: string; faction: string | null } | null }[]>();

  if (!rows || rows.length < 2) {
    return { title: "UFF — Matchup Recap" };
  }

  const [a, b] = rows;
  const winner = a.points > b.points ? a : b;
  const title  = `${winner.league_members?.team_name ?? "Unknown"} wins Week ${a.week} — UFF`;
  const desc   = `${a.league_members?.team_name ?? "Team A"} ${a.points.toFixed(2)} vs ${b.league_members?.team_name ?? "Team B"} ${b.points.toFixed(2)} — Oracle recap inside.`;

  return {
    title,
    description: desc,
    openGraph: {
      title,
      description: desc,
      siteName: "Ultimate Fantasy Football",
      type: "website",
    },
    twitter: {
      card: "summary",
      title,
      description: desc,
    },
  };
}

function NotFound() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-6 px-6"
      style={{ background: "#0d0d1a", color: "#f4f4f8" }}>
      <p className="text-4xl select-none">🔮</p>
      <div className="text-center flex flex-col gap-2">
        <h1 className="text-xl font-semibold" style={{ color: GOLD }}>Matchup not found</h1>
        <p className="text-sm" style={{ color: "#8888aa" }}>This matchup may not exist or isn&apos;t finalized yet.</p>
      </div>
      <Link
        href="/"
        className="rounded-md px-4 py-2 text-sm font-semibold"
        style={{ background: HERO_COLOR, color: "#f4f4f8" }}
      >
        Join UFF →
      </Link>
    </div>
  );
}

export default async function ShareMatchupPage({
  params,
}: {
  params: Promise<{ matchupId: string }>;
}) {
  const { matchupId } = await params;
  const matchupIdNum = parseInt(matchupId, 10);
  if (isNaN(matchupIdNum)) return <NotFound />;

  const admin = createAdminClient();

  const { data: rows } = await admin
    .from("uff_matchups")
    .select("id, matchup_id, week, points, is_complete, oracle_recap, member_id, league_id, league_members(team_name, faction)")
    .eq("matchup_id", matchupIdNum)
    .returns<ShareMatchupRow[]>();

  if (!rows || rows.length < 2) return <NotFound />;

  // Only share complete matchups
  if (!rows[0].is_complete && !rows[1].is_complete) return <NotFound />;

  const [a, b]    = rows;
  const aWins     = a.points > b.points;
  const winner    = aWins ? a : b;
  const loser     = aWins ? b : a;
  const recap     = rows[0].oracle_recap ?? rows[1]?.oracle_recap ?? null;
  const week      = rows[0].week;
  const leagueId  = rows[0].league_id;

  // Fetch league name
  const { data: league } = await admin
    .from("uff_leagues")
    .select("name, season")
    .eq("id", leagueId)
    .maybeSingle<LeagueRow>();

  const leagueName = league?.name ?? "UFF League";
  const season     = league?.season ?? "";

  const winnerFaction = winner.league_members?.faction ?? null;
  const loserFaction  = loser.league_members?.faction ?? null;
  const winnerColor   = factionColor(winnerFaction);
  const loserColor    = factionColor(loserFaction);
  const diff          = Math.abs(a.points - b.points).toFixed(2);

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center gap-6 px-4 py-12"
      style={{ background: "#0d0d1a", color: "#f4f4f8" }}
    >
      {/* UFF wordmark */}
      <div className="flex flex-col items-center gap-1">
        <p className="text-xs uppercase tracking-[0.3em]" style={{ color: GOLD }}>
          Ultimate Fantasy Football
        </p>
        <p className="text-xs" style={{ color: "#8888aa" }}>
          {leagueName} &middot; Season {season} &middot; Week {week}
        </p>
      </div>

      {/* Recap card */}
      <div
        className="w-full max-w-md rounded-2xl border flex flex-col gap-0 overflow-hidden"
        style={{ borderColor: "#2a2a40", background: "#0d0d1a" }}
      >
        {/* Winner banner */}
        <div
          className="px-5 py-4 flex items-center gap-3"
          style={{ background: winnerColor + "18", borderBottom: "1px solid " + winnerColor + "33" }}
        >
          <div className="flex-1">
            <p className="text-xs uppercase tracking-wide font-semibold" style={{ color: winnerColor }}>
              {winner.league_members?.faction ?? "Winner"}
            </p>
            <p className="text-lg font-bold" style={{ color: winnerColor }}>
              {winner.league_members?.team_name ?? "Unknown"}
            </p>
          </div>
          <div className="text-right">
            <p className="text-3xl font-bold tabular-nums" style={{ color: winnerColor }}>
              {winner.points.toFixed(2)}
            </p>
            <p className="text-xs font-semibold" style={{ color: "#3DDC84" }}>
              Winner &middot; +{diff}
            </p>
          </div>
        </div>

        {/* Divider with "vs" */}
        <div className="flex items-center gap-3 px-5 py-2" style={{ borderBottom: "1px solid #2a2a40" }}>
          <div className="flex-1 h-px" style={{ background: "#2a2a40" }} />
          <span className="text-xs font-semibold" style={{ color: "#8888aa" }}>vs</span>
          <div className="flex-1 h-px" style={{ background: "#2a2a40" }} />
        </div>

        {/* Loser row */}
        <div className="px-5 py-4 flex items-center gap-3" style={{ borderBottom: recap ? "1px solid #2a2a40" : "none" }}>
          <div className="flex-1">
            <p className="text-xs uppercase tracking-wide font-semibold" style={{ color: loserColor }}>
              {loser.league_members?.faction ?? ""}
            </p>
            <p className="text-base font-semibold" style={{ color: "#d4d4e8" }}>
              {loser.league_members?.team_name ?? "Unknown"}
            </p>
          </div>
          <p className="text-2xl font-bold tabular-nums" style={{ color: "#8888aa" }}>
            {loser.points.toFixed(2)}
          </p>
        </div>

        {/* Oracle recap */}
        {recap && (
          <div className="px-5 py-4 flex flex-col gap-2" style={{ background: "rgba(255,215,0,0.03)" }}>
            <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: GOLD }}>
              🔮 Oracle&apos;s Vision
            </p>
            <p className="text-sm leading-relaxed" style={{ color: "#d4d4e8", fontStyle: "italic" }}>
              {recap}
            </p>
          </div>
        )}
      </div>

      {/* CTA */}
      <div className="flex flex-col items-center gap-3 text-center">
        <p className="text-sm" style={{ color: "#8888aa" }}>
          Faction war. 18 weekly power tokens. Oracle AI recaps.
        </p>
        <Link
          href="/"
          className="rounded-md px-5 py-2.5 text-sm font-semibold transition hover:opacity-90"
          style={{ background: HERO_COLOR, color: "#f4f4f8" }}
        >
          Join Ultimate Fantasy Football →
        </Link>
      </div>

      {/* Footer */}
      <p className="text-xs" style={{ color: "#4a4a6a" }}>
        uff-platform.vercel.app
      </p>
    </div>
  );
}
