import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import PlayerSearch from "./PlayerSearch";

export default async function PlayersPage({ params }: { params: Promise<{ id: string }> }) {
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

  return (
    <div className="min-h-screen px-4 py-10 sm:px-8" style={{ background: "#0d0d1a", color: "#f4f4f8" }}>
      <main className="mx-auto max-w-2xl flex flex-col gap-6">
        <header className="flex flex-col gap-2">
          <Link href={`/dashboard/league/${leagueId}`} className="text-sm underline" style={{ color: "#0057FF" }}>
            &larr; Back to {league?.name ?? "League"}
          </Link>
          <p className="text-sm uppercase tracking-[0.3em]" style={{ color: "#FFD700" }}>
            {league?.name}
          </p>
          <h1 className="text-3xl sm:text-4xl" style={{ fontFamily: "var(--font-display, sans-serif)", color: "#0057FF" }}>
            Player Search
          </h1>
          <p className="text-sm" style={{ color: "#8888aa" }}>
            Search any NFL player — see their ownership status, injury, and team.
          </p>
        </header>

        <PlayerSearch leagueId={leagueId} />
      </main>
    </div>
  );
}
