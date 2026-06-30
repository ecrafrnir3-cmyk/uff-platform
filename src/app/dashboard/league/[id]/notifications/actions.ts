"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function markAllRead(leagueId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  await admin
    .from("uff_notifications")
    .update({ read: true })
    .eq("league_id", leagueId)
    .eq("user_id", user.id)
    .eq("read", false);

  revalidatePath(`/dashboard/league/${leagueId}/notifications`);
  revalidatePath(`/dashboard/league/${leagueId}`);
}
