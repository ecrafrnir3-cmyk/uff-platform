import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import LeagueNav from "./LeagueNav";

export default async function LeagueLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id: leagueId } = await params;
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Verify membership + grab commissioner_id in one query
  const [{ data: member }, { data: league }] = await Promise.all([
    supabase
      .from("league_members")
      .select("id")
      .eq("league_id", leagueId)
      .eq("user_id", user.id)
      .maybeSingle(),
    supabase
      .from("uff_leagues")
      .select("commissioner_id")
      .eq("id", leagueId)
      .maybeSingle(),
  ]);

  if (!member) redirect("/dashboard?error=" + encodeURIComponent("You're not a member of that league."));

  const isCommissioner = league?.commissioner_id === user.id;

  // Pending incoming trade count for nav badge
  const { count: pendingCount } = await supabase
    .from("uff_trades")
    .select("id", { count: "exact", head: true })
    .eq("league_id", leagueId)
    .eq("receiver_id", member.id)
    .eq("status", "pending");

  return (
    <>
      <LeagueNav
        leagueId={leagueId}
        isCommissioner={isCommissioner}
        pendingTradeCount={pendingCount ?? 0}
      />
      {children}
    </>
  );
}
