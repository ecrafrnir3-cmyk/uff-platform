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

  // Verify membership (lightweight check -- pages do their own full queries)
  const { data: member } = await supabase
    .from("league_members")
    .select("id")
    .eq("league_id", leagueId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!member) redirect("/dashboard?error=" + encodeURIComponent("You're not a member of that league."));

  return (
    <>
      <LeagueNav leagueId={leagueId} />
      {children}
    </>
  );
}
