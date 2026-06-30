import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import ChatInterface from "./ChatInterface";

export default async function ChatPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: leagueId } = await params;
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: me } = await supabase
    .from("league_members")
    .select("id, team_name")
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
    <div className="px-4 py-6 sm:px-8" style={{ background: "#0d0d1a", color: "#f4f4f8", minHeight: "100vh" }}>
      <main className="mx-auto max-w-2xl flex flex-col gap-4">
        <header className="flex flex-col gap-1">
          <Link href={`/dashboard/league/${leagueId}`} className="text-sm underline" style={{ color: "#0057FF" }}>
            &larr; Back to {league?.name ?? "League"}
          </Link>
          <p className="text-sm uppercase tracking-[0.3em]" style={{ color: "#FFD700" }}>
            {league?.name}
          </p>
          <h1 className="text-2xl sm:text-3xl" style={{ fontFamily: "var(--font-display, sans-serif)", color: "#0057FF" }}>
            League Assistant
          </h1>
        </header>

        <ChatInterface leagueId={leagueId} teamName={me.team_name} />
      </main>
    </div>
  );
}
