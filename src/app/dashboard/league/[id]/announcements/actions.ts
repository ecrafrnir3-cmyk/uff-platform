"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail, getUserEmail, announcementHtml } from "@/lib/email";
import { createNotification } from "@/lib/notifications";

async function assertCommissioner(supabase: Awaited<ReturnType<typeof createClient>>, userId: string, leagueId: string) {
  const { data: league } = await supabase
    .from("uff_leagues")
    .select("commissioner_id")
    .eq("id", leagueId)
    .maybeSingle();
  return league?.commissioner_id === userId;
}

export async function createAnnouncement(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const leagueId = formData.get("leagueId") as string;
  const title = (formData.get("title") as string).trim();
  const body  = (formData.get("body") as string).trim();
  const pinned = formData.get("pinned") === "1";

  if (!title || !body) {
    redirect(`/dashboard/league/${leagueId}/announcements?error=${encodeURIComponent("Title and message are required.")}`);
  }

  const isComm = await assertCommissioner(supabase, user.id, leagueId);
  if (!isComm) {
    redirect(`/dashboard/league/${leagueId}/announcements?error=${encodeURIComponent("Only the commissioner can post announcements.")}`);
  }

  const { error } = await supabase
    .from("uff_announcements")
    .insert({ league_id: leagueId, author_id: user.id, title, body, pinned });

  if (error) {
    redirect(`/dashboard/league/${leagueId}/announcements?error=${encodeURIComponent("Failed to post announcement.")}`);
  }

  // ── Broadcast: email + in-app notification to all members ────────────────
  try {
    const admin = createAdminClient();
    const [{ data: leagueRow }, { data: members }] = await Promise.all([
      supabase.from("uff_leagues").select("name").eq("id", leagueId).maybeSingle(),
      admin.from("league_members").select("user_id").eq("league_id", leagueId),
    ]);
    const leagueName = leagueRow?.name ?? "Your League";

    await Promise.all(
      (members ?? []).map(async (m) => {
        if (m.user_id === user.id) return; // skip commissioner themselves
        await Promise.all([
          // Email
          getUserEmail(m.user_id).then(async (email) => {
            if (!email) return;
            await sendEmail({
              to: email,
              subject: `📢 ${leagueName}: ${title}`,
              html: announcementHtml({ leagueId, leagueName, title, body }),
            });
          }),
          // In-app notification
          createNotification({
            leagueId,
            userId: m.user_id,
            type: "announcement",
            title: `📢 ${title}`,
            body: body.length > 120 ? body.slice(0, 117) + "…" : body,
          }),
        ]);
      })
    );
  } catch (broadcastErr) {
    console.error("[announcements] broadcast failed (non-blocking):", broadcastErr);
  }

  revalidatePath(`/dashboard/league/${leagueId}`);
  redirect(`/dashboard/league/${leagueId}/announcements?posted=1`);
}

export async function deleteAnnouncement(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const leagueId = formData.get("leagueId") as string;
  const id = formData.get("id") as string;

  const isComm = await assertCommissioner(supabase, user.id, leagueId);
  if (!isComm) {
    redirect(`/dashboard/league/${leagueId}/announcements?error=${encodeURIComponent("Only the commissioner can delete announcements.")}`);
  }

  await supabase.from("uff_announcements").delete().eq("id", id).eq("league_id", leagueId);

  revalidatePath(`/dashboard/league/${leagueId}`);
  redirect(`/dashboard/league/${leagueId}/announcements`);
}

export async function togglePin(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const leagueId = formData.get("leagueId") as string;
  const id = formData.get("id") as string;
  const pinned = formData.get("pinned") === "true";

  const isComm = await assertCommissioner(supabase, user.id, leagueId);
  if (!isComm) return;

  await supabase.from("uff_announcements").update({ pinned: !pinned }).eq("id", id).eq("league_id", leagueId);
  revalidatePath(`/dashboard/league/${leagueId}`);
  redirect(`/dashboard/league/${leagueId}/announcements`);
}
