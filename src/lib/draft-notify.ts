import { SupabaseClient } from "@supabase/supabase-js";
import { createNotification } from "@/lib/notifications";
import { getUserEmail, sendEmail, onTheClockHtml } from "@/lib/email";

// Notify whoever is on the clock after a pick lands. Shared by the manual pick,
// self-autodraft, and force-autopick paths so the next picker always hears about it.
// Never throws — notification failure must not fail the pick.
export async function notifyNextPicker(
  supabase: SupabaseClient,
  leagueId: string,
): Promise<void> {
  try {
    const { data: leagueData } = await supabase
      .from("uff_leagues")
      .select("draft_order, max_teams, draft_rounds")
      .eq("id", leagueId)
      .maybeSingle();
    if (!leagueData) return;

    const { data: lastPickRow } = await supabase
      .from("uff_draft_picks")
      .select("pick_no")
      .eq("league_id", leagueId)
      .order("pick_no", { ascending: false })
      .limit(1)
      .maybeSingle();

    const lastPickNo: number = (lastPickRow?.pick_no as number | null) ?? 0;
    const nextPickNo = lastPickNo + 1;
    const totalPicks = leagueData.max_teams * leagueData.draft_rounds;
    if (nextPickNo > totalPicks) return;

    const draftOrder = leagueData.draft_order as string[];
    const round = Math.ceil(nextPickNo / leagueData.max_teams);
    const posInRound = nextPickNo - (round - 1) * leagueData.max_teams;
    const col = round % 2 === 1 ? posInRound : leagueData.max_teams - posInRound + 1;
    const nextMemberId = draftOrder[col - 1];
    if (!nextMemberId) return;

    const { data: nextMember } = await supabase
      .from("league_members")
      .select("user_id, team_name")
      .eq("id", nextMemberId)
      .maybeSingle();
    if (!nextMember?.user_id) return;

    await createNotification({
      leagueId,
      userId: nextMember.user_id,
      type: "on_the_clock",
      title: "You're on the clock!",
      body: `Round ${round} · Pick ${nextPickNo}/${totalPicks} — make your selection.`,
    });

    const email = await getUserEmail(nextMember.user_id);
    if (email) {
      await sendEmail({
        to: email,
        subject: "⏰ You're on the clock — make your pick!",
        html: onTheClockHtml({
          teamName: nextMember.team_name as string,
          round,
          pickNo: nextPickNo,
          totalPicks,
          leagueId,
        }),
      });
    }
  } catch (e) {
    console.error("[draft] next-pick notification failed:", e);
  }
}
