import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getIssue, listIssues } from "@/lib/lore";
import ComicBody from "@/components/story/ComicBody";

export const dynamic = "force-dynamic";

export default async function IssuePage({
  params,
}: {
  params: Promise<{ id: string; slug: string }>;
}) {
  const { id: leagueId, slug } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const issue = await getIssue(slug);
  if (!issue) notFound();

  const all = await listIssues();
  const idx = all.findIndex((i) => i.slug === issue.slug);
  const newer = idx > 0 ? all[idx - 1] : null;
  const older = idx >= 0 && idx < all.length - 1 ? all[idx + 1] : null;
  const base = `/dashboard/league/${leagueId}`;

  return (
    <main className="mx-auto max-w-3xl px-4 py-6">
      <Link href={`${base}/story`} className="text-xs underline" style={{ color: "#8888aa" }}>
        ← All issues
      </Link>

      <article className="mt-4">
        <ComicBody markdown={issue.body} />
      </article>

      <nav className="mt-8 flex items-center justify-between gap-3 border-t pt-4" style={{ borderColor: "#2a2a40" }}>
        {older ? (
          <Link href={`${base}/story/${older.slug}`} className="text-sm underline" style={{ color: "#FFD700" }}>
            ← #{String(older.number).padStart(3, "0")} {older.title}
          </Link>
        ) : (
          <span />
        )}
        {newer ? (
          <Link href={`${base}/story/${newer.slug}`} className="text-sm underline" style={{ color: "#FFD700" }}>
            #{String(newer.number).padStart(3, "0")} {newer.title} →
          </Link>
        ) : (
          <span />
        )}
      </nav>
    </main>
  );
}
