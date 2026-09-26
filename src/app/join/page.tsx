import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// The invite email's button lands here (audit A2-03). Signed in: straight to the dashboard
// with the code filled in. Signed out: to login, and back here afterwards.
export default async function JoinPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string }>;
}) {
  const { code } = await searchParams;
  const safe = (code ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) redirect(safe ? `/dashboard?code=${safe}` : "/dashboard");
  redirect(safe ? `/login?next=${encodeURIComponent(`/join?code=${safe}`)}` : "/login");
}
