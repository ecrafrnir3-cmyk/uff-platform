import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAnnouncement, deleteAnnouncement, togglePin } from "./actions";

interface Announcement {
  id: string;
  title: string;
  body: string;
  pinned: boolean;
  created_at: string;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default async function AnnouncementsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; posted?: string }>;
}) {
  const { id: leagueId } = await params;
  const { error, posted } = await searchParams;
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: league } = await supabase
    .from("uff_leagues")
    .select("id, name, commissioner_id")
    .eq("id", leagueId)
    .maybeSingle();
  if (!league) redirect("/dashboard?error=" + encodeURIComponent("League not found."));

  const { data: me } = await supabase
    .from("league_members")
    .select("id")
    .eq("league_id", leagueId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!me) redirect("/dashboard?error=" + encodeURIComponent("You're not a member of that league."));

  const isCommissioner = league.commissioner_id === user.id;

  const { data: announcements } = await supabase
    .from("uff_announcements")
    .select("id, title, body, pinned, created_at")
    .eq("league_id", leagueId)
    .order("pinned", { ascending: false })
    .order("created_at", { ascending: false })
    .returns<Announcement[]>();

  return (
    <div className="min-h-screen px-6 py-12 sm:px-12" style={{ background: "#0d0d1a", color: "#f4f4f8" }}>
      <main className="mx-auto flex max-w-2xl flex-col gap-8">
        <header className="flex flex-col gap-2">
          <Link href={`/dashboard/league/${leagueId}`} className="text-sm underline" style={{ color: "#0057FF" }}>
            &larr; Back to {league.name}
          </Link>
          <p className="text-sm uppercase tracking-[0.3em]" style={{ color: "#FFD700" }}>
            Ultimate Fantasy Football
          </p>
          <h1 className="text-3xl sm:text-4xl" style={{ fontFamily: "var(--font-display, sans-serif)", color: "#0057FF" }}>
            Bulletin Board
          </h1>
        </header>

        {error && (
          <p className="rounded-md border px-3 py-2 text-sm" style={{ borderColor: "#CC0000", color: "#ff8a8a", background: "#1a0e16" }}>
            {decodeURIComponent(error)}
          </p>
        )}
        {posted && (
          <p className="rounded-md border px-3 py-2 text-sm" style={{ borderColor: "#3DDC84", color: "#3DDC84", background: "rgba(61,220,132,0.06)" }}>
            Announcement posted!
          </p>
        )}

        {/* Post form — commissioner only */}
        {isCommissioner && (
          <section className="flex flex-col gap-4 rounded-lg border p-5" style={{ borderColor: "#FFD70044" }}>
            <h2 className="font-semibold" style={{ color: "#FFD700" }}>Post Announcement</h2>
            <form action={createAnnouncement} className="flex flex-col gap-3">
              <input type="hidden" name="leagueId" value={leagueId} />
              <input
                name="title"
                type="text"
                required
                placeholder="Title"
                maxLength={120}
                className="rounded-md border px-3 py-2 text-sm"
                style={{ borderColor: "#2a2a40", background: "#15151f", color: "#f4f4f8" }}
              />
              <textarea
                name="body"
                required
                rows={4}
                placeholder="Message to your league..."
                maxLength={2000}
                className="rounded-md border px-3 py-2 text-sm resize-none"
                style={{ borderColor: "#2a2a40", background: "#15151f", color: "#f4f4f8" }}
              />
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-2 text-sm text-white cursor-pointer">
                  <input type="checkbox" name="pinned" value="1" className="rounded" />
                  📌 Pin to top
                </label>
                <button
                  type="submit"
                  className="rounded-md px-4 py-2 text-sm font-semibold"
                  style={{ background: "#FFD700", color: "#0d0d1a" }}
                >
                  Post
                </button>
              </div>
            </form>
          </section>
        )}

        {/* Announcements list */}
        {(announcements ?? []).length === 0 ? (
          <div className="rounded-lg border p-6 text-center text-sm text-white" style={{ borderColor: "#2a2a40" }}>
            No announcements yet.{isCommissioner && " Post one above to notify your league."}
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {(announcements ?? []).map((a) => (
              <div
                key={a.id}
                className="flex flex-col gap-2 rounded-lg border p-5"
                style={{
                  borderColor: a.pinned ? "rgba(255,215,0,0.4)" : "#2a2a40",
                  background: a.pinned ? "rgba(255,215,0,0.03)" : "#0d0d1a",
                }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    {a.pinned && <span className="text-sm">📌</span>}
                    <h3 className="font-semibold" style={{ color: a.pinned ? "#FFD700" : "#f4f4f8" }}>
                      {a.title}
                    </h3>
                  </div>
                  <span className="text-xs shrink-0" style={{ color: "#8888aa" }}>
                    {timeAgo(a.created_at)}
                  </span>
                </div>
                <p className="text-sm leading-relaxed whitespace-pre-wrap" style={{ color: "#d4d4e8" }}>
                  {a.body}
                </p>
                {isCommissioner && (
                  <div className="flex gap-2 pt-1">
                    <form action={togglePin}>
                      <input type="hidden" name="leagueId" value={leagueId} />
                      <input type="hidden" name="id" value={a.id} />
                      <input type="hidden" name="pinned" value={String(a.pinned)} />
                      <button
                        type="submit"
                        className="text-xs underline"
                        style={{ color: "#8888aa" }}
                      >
                        {a.pinned ? "Unpin" : "Pin"}
                      </button>
                    </form>
                    <form action={deleteAnnouncement}>
                      <input type="hidden" name="leagueId" value={leagueId} />
                      <input type="hidden" name="id" value={a.id} />
                      <button
                        type="submit"
                        className="text-xs underline"
                        style={{ color: "#CC0000" }}
                      >
                        Delete
                      </button>
                    </form>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
