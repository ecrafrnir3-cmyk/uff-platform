import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import MarkReadButton from "./MarkReadButton";

interface Notification {
  id: string;
  type: string;
  title: string;
  body: string | null;
  read: boolean;
  created_at: string;
}

const TYPE_ICON: Record<string, string> = {
  trade_proposed:  "🤝",
  trade_accepted:  "✅",
  trade_rejected:  "❌",
  trade_approved:  "✅",
  trade_vetoed:    "🚫",
  waiver_results:  "📋",
  announcement:    "📢",
};

function timeAgo(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default async function NotificationsPage({ params }: { params: Promise<{ id: string }> }) {
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

  // Fetch all notifications for this user + league, ordered newest-first
  const admin = createAdminClient();
  const { data: notifications } = await admin
    .from("uff_notifications")
    .select("id, type, title, body, read, created_at")
    .eq("league_id", leagueId)
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(50)
    .returns<Notification[]>();

  const unread = (notifications ?? []).filter(n => !n.read).length;

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
          <div className="flex items-center justify-between">
            <h1 className="text-3xl sm:text-4xl" style={{ fontFamily: "var(--font-display, sans-serif)", color: "#0057FF" }}>
              Notifications
            </h1>
            {unread > 0 && (
              <MarkReadButton leagueId={leagueId} />
            )}
          </div>
          {unread > 0 && (
            <p className="text-sm" style={{ color: "#8888aa" }}>
              {unread} unread
            </p>
          )}
        </header>

        {/* List */}
        {(notifications ?? []).length === 0 ? (
          <div className="text-center py-20" style={{ color: "#6b6b8a" }}>
            <p className="text-4xl mb-3">🔔</p>
            <p className="text-sm">No notifications yet. Activity will appear here when trades are proposed, accepted, vetoed, or waivers process.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {(notifications ?? []).map(n => (
              <div
                key={n.id}
                className="flex items-start gap-3 rounded-lg px-4 py-4"
                style={{
                  background: n.read ? "#13132b" : "#0d1a2e",
                  border: `1px solid ${n.read ? "#2a2a40" : "#0057FF44"}`,
                }}
              >
                {/* Unread dot */}
                <div className="shrink-0 mt-1 w-2 h-2 rounded-full" style={{ background: n.read ? "transparent" : "#0057FF" }} />

                {/* Icon */}
                <span className="text-lg shrink-0">{TYPE_ICON[n.type] ?? "🔔"}</span>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold" style={{ color: n.read ? "#d4d4e8" : "#f4f4f8" }}>
                    {n.title}
                  </p>
                  {n.body && (
                    <p className="text-xs mt-0.5 truncate" style={{ color: "#8888aa" }}>
                      {n.body}
                    </p>
                  )}
                </div>

                {/* Time */}
                <span className="shrink-0 text-xs" style={{ color: "#6b6b8a" }}>
                  {timeAgo(n.created_at)}
                </span>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
