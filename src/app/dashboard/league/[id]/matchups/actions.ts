"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function finalizeWeek(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const leagueId = formData.get("leagueId") as string;
  const week = parseInt(formData.get("week") as string);

  const { error } = await supabase.rpc("finalize_week", {
    p_league_id: leagueId,
    p_user_id: user.id,
    p_week: week,
  });

  if (error) {
    redirect(
      `/dashboard/league/${leagueId}/matchups?week=${week}&error=` +
        encodeURIComponent(error.message)
    );
  }

  revalidatePath(`/dashboard/league/${leagueId}/matchups`);
  revalidatePath(`/dashboard/league/${leagueId}/standings`);
  redirect(`/dashboard/league/${leagueId}/matchups?week=${week}&saved=1`);
}
