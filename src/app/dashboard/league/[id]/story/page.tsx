import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { listIssues } from "@/lib/lore";

export const dynamic = "force-dynamic";

export default async function StoryIndexPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: leagueId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const issues = await listIssues();
  const base = `/dashboard/league/${leagueId}`;

  return (
    <main className="mx-auto max-w-3xl px-4 py-6">
      <header className="mb-6">
        <h1 className="text-2xl font-black uppercase tracking-widest" style={{ color: "#FFD700" }}>
          The First War
        </h1>
        <p className="mt-1 text-sm" style={{ color: "#8888aa" }}>
          The season written as it happens. Every fight below came off a real scoreboard — the
          front only moves when a Vanguard team beats a Dominion team on the field.{" "}
          <Link href={`${base}/war`} className="underline" style={{ color: "#FFD700" }}>
            See the war map
          </Link>
          .
        </p>
      </header>

      {issues.length === 0 ? (
        <p
          className="rounded-lg px-4 py-6 text-sm"
          style={{ background: "#15151f", border: "1px solid #2a2a40", color: "#8888aa" }}
        >
          No issues have been published yet.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {issues.map((it) => (
            <li key={it.slug}>
              <Link
                href={`${base}/story/${it.slug}`}
                className="block rounded-lg px-4 py-4 transition-opacity hover:opacity-80"
                style={{ background: "#15151f", border: "1px solid #2a2a40" }}
              >
                <p className="text-xs font-bold uppercase tracking-widest" style={{ color: "#8888aa" }}>
                  Issue #{String(it.number).padStart(3, "0")}
                </p>
                <p className="mt-1 text-lg font-black" style={{ color: "#FFD700" }}>
                  {it.title}
                </p>
                {it.subtitle && (
                  <p className="mt-1 text-sm" style={{ color: "#d4d4e8" }}>
                    {it.subtitle}
                  </p>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
