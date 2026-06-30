import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  accepted:  { label: "Completed", color: "#3DDC84", bg: "rgba(61,220,132,0.08)" },
  vetoed:    { label: "Vetoed",    color: "#CC0000", bg: "rgba(204,0,0,0.08)" },
  rejected:  { label: "Rejected",  color: "#6b6b8a", bg: "rgba(107,107,138,0.08)" },
  cancelled: { label: "Cancelled", color: "#6b6b8a", bg: "rgba(107,107,138,0.08)" },
};

interface TradeRow {
  id: string;
  proposer_id: string;
  receiver_id: string;
  proposer_player_ids: string[];
  receiver_player_ids: string[];
  status: string;
  created_at: string;
  updated_at: string;
  veto_reason: string | null;
}

export default async function TradesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: leagueId } = await params;
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: me } = await supabase
    .from("league_members")
    .select("id")
    .eq("league_id", leagueId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!me) redirect(`/dashboard?error=${encodeURIComponent("Not a member of this league.")}`);

  const { data: league } = await supabase
    .from("uff_leagues")
    .select("name")
    .eq("id", leagueId)
    .maybeSingle();
  if (!league) redirect("/dashboard");

  const { data: tradeRows } = await supabase
    .from("uff_trades")
    .select("id, proposer_id, receiver_id, proposer_player_ids, receiver_player_ids, status, created_at, updated_at, veto_reason")
    .eq("league_id", leagueId)
    .in("status", ["accepted", "vetoed", "rejected", "cancelled"])
    .order("updated_at", { ascending: false })
    .returns<TradeRow[]>();

  const trades = tradeRows ?? [];

  // Collect all unique IDs to batch-fetch
  const allPlayerIds = [...new Set(trades.flatMap(t => [...t.proposer_player_ids, ...t.receiver_player_ids]))];
  const allMemberIds = [...new Set(trades.flatMap(t => [t.proposer_id, t.receiver_id]))];

  const [{ data: playerRows }, { data: memberRows }] = await Promise.all([
    allPlayerIds.length > 0
      ? supabase.from("players").select("id, full_name, position").in("id", allPlayerIds)
      : { data: [] },
    allMemberIds.length > 0
      ? supabase.from("league_members").select("id, team_name").in("id", allMemberIds).returns<{ id: string; team_name: string }[]>()
      : { data: [] },
  ]);

  const playerMap: Record<string, { full_name: string; position: string | null }> = {};
  for (const p of playerRows ?? []) playerMap[p.id] = p;

  const memberMap: Record<string, string> = {};
  for (const m of memberRows ?? []) memberMap[m.id] = m.team_name;

  const formatPlayers = (ids: string[]) =>
    ids.map(id => {
      const p = playerMap[id];
      return p ? `${p.full_name}${p.position ? ` (${p.position})` : ""}` : id;
    });

  return (
    <div className="min-h-screen px-4 py-10 sm:px-8" style={{ background: "#0d0d1a", color: "#f4f4f8" }}>
      <main className="mx-auto max-w-3xl flex flex-col gap-6">
        <header className="flex flex-col gap-2">
          <Link href={`/dashboard/league/${leagueId}`} className="text-sm underline" style={{ color: "#0057FF" }}>
            &larr; Back to {league.name}
          </Link>
          <p className="text-sm uppercase tracking-[0.3em]" style={{ color: "#FFD700" }}>
            {league.name}
          </p>
          <h1 className="text-3xl sm:text-4xl" style={{ fontFamily: "var(--font-display, sans-serif)", color: "#0057FF" }}>
            Trade History
          </h1>
        </header>

        {trades.length === 0 ? (
          <p className="text-sm" style={{ color: "#6b6b8a" }}>No completed trades yet this season.</p>
        ) : (
          <div className="flex flex-col gap-4">
            {trades.map((t) => {
              const cfg = STATUS_CONFIG[t.status] ?? { label: t.status, color: "#8888aa", bg: "rgba(136,136,170,0.08)" };
              const propPlayers = formatPlayers(t.proposer_player_ids);
              const recvPlayers = formatPlayers(t.receiver_player_ids);
              const date = new Date(t.updated_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

              return (
                <div
                  key={t.id}
                  className="rounded-xl border p-4 flex flex-col gap-3"
                  style={{ borderColor: "#2a2a40", background: "#13132b" }}
                >
                  {/* Header row */}
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <p className="text-sm font-bold" style={{ color: "#f4f4f8" }}>
                      {memberMap[t.proposer_id] ?? "Team A"} ↔ {memberMap[t.receiver_id] ?? "Team B"}
                    </p>
                    <div className="flex items-center gap-2">
                      <span
                        className="inline-block rounded px-2 py-0.5 text-xs font-bold uppercase"
                        style={{ color: cfg.color, background: cfg.bg, border: `1px solid ${cfg.color}33` }}
                      >
                        {cfg.label}
                      </span>
                      <span className="text-xs" style={{ color: "#6b6b8a" }}>{date}</span>
                    </div>
                  </div>

                  {/* Players */}
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <p className="text-xs font-semibold uppercase mb-1" style={{ color: "#8888aa" }}>
                        {memberMap[t.proposer_id] ?? "Proposer"} sent
                      </p>
                      <ul className="flex flex-col gap-0.5">
                        {propPlayers.map((name, i) => (
                          <li key={i} style={{ color: "#3DDC84", fontSize: "13px" }}>{name}</li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <p className="text-xs font-semibold uppercase mb-1" style={{ color: "#8888aa" }}>
                        {memberMap[t.receiver_id] ?? "Receiver"} sent
                      </p>
                      <ul className="flex flex-col gap-0.5">
                        {recvPlayers.map((name, i) => (
                          <li key={i} style={{ color: "#FFD700", fontSize: "13px" }}>{name}</li>
                        ))}
                      </ul>
                    </div>
                  </div>

                  {/* Veto reason */}
                  {t.veto_reason && (
                    <p className="text-xs italic" style={{ color: "#8888aa" }}>
                      Veto reason: &ldquo;{t.veto_reason}&rdquo;
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
