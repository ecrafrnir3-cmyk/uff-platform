import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import CharacterSilhouette from "@/components/CharacterSilhouette";

interface Character {
  id: number;
  name: string;
  epithet: string;
  domain: string;
  faction: "hero" | "villain";
  starter_story: string;
  art_url: string | null;
}

export default async function CharacterPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: leagueId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: league } = await supabase
    .from("uff_leagues")
    .select("id, name")
    .eq("id", leagueId)
    .maybeSingle();
  if (!league) redirect("/dashboard?error=" + encodeURIComponent("League not found."));

  const { data: me } = await supabase
    .from("league_members")
    .select(
      "id, faction, team_name, character_id, uff_characters(id, name, epithet, domain, faction, starter_story, art_url)"
    )
    .eq("league_id", leagueId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!me) redirect("/dashboard?error=" + encodeURIComponent("You're not a member of that league."));

  const rawChar = me.uff_characters as unknown;
  const character = (Array.isArray(rawChar) ? rawChar[0] : rawChar) as Character | null;
  const faction = (character?.faction ?? (me.faction as "hero" | "villain" | null)) ?? null;
  const isHero = faction === "hero";
  const accent = isHero ? "#0057FF" : "#CC0000";
  const factionLabel = isHero ? "⚔️ The Vanguard · Hero" : "🐍 The Dominion · Villain";

  return (
    <div className="min-h-screen px-4 py-10 sm:px-8" style={{ background: "#0d0d1a", color: "#f4f4f8" }}>
      <main className="mx-auto max-w-4xl flex flex-col gap-6">
        <header className="flex flex-col gap-2">
          <Link href={`/dashboard/league/${leagueId}`} className="text-sm underline" style={{ color: "#0057FF" }}>
            &larr; Back to {league.name}
          </Link>
          <p className="text-sm uppercase tracking-[0.3em]" style={{ color: "#FFD700" }}>
            {me.team_name}
          </p>
          <h1 className="text-3xl sm:text-4xl" style={{ fontFamily: "var(--font-display, sans-serif)", color: "#0057FF" }}>
            Your Character
          </h1>
        </header>

        {!character ? (
          <section
            className="flex flex-col items-center gap-4 rounded-lg border-2 border-dashed py-12 px-6 text-center"
            style={{ borderColor: "#2a2a40" }}
          >
            <span className="text-4xl select-none">🎭</span>
            <p className="text-base font-semibold">You haven&apos;t been cast yet</p>
            <p className="max-w-md text-sm leading-relaxed" style={{ color: "#a0a0c0" }}>
              Choose your side — Hero or Villain — on the league page, and one of the twenty legends
              of the war will be drawn for you.
            </p>
            <Link
              href={`/dashboard/league/${leagueId}`}
              className="rounded-md px-4 py-2 text-sm font-semibold"
              style={{ background: "#0057FF", color: "#f4f4f8" }}
            >
              Choose your faction
            </Link>
          </section>
        ) : (
          <div className="grid gap-6 sm:grid-cols-[minmax(0,300px)_1fr]">
            {/* Portrait */}
            <div className="flex flex-col gap-3">
              {character.art_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={character.art_url}
                  alt={character.name}
                  className="w-full rounded-[14px]"
                  style={{ aspectRatio: "3 / 4", objectFit: "cover", border: `1px solid ${accent}55` }}
                />
              ) : (
                <CharacterSilhouette faction={isHero ? "hero" : "villain"} name={character.name} />
              )}
              <span
                className="self-start rounded-full px-3 py-1 text-xs font-semibold"
                style={{ background: isHero ? "rgba(0,87,255,0.15)" : "rgba(204,0,0,0.15)", color: accent }}
              >
                {factionLabel}
              </span>
            </div>

            {/* Story */}
            <div className="flex flex-col gap-4">
              <div>
                <h2 className="text-2xl sm:text-3xl" style={{ fontFamily: "var(--font-display, sans-serif)", color: "#FFD700" }}>
                  {character.name}
                </h2>
                <p className="text-lg italic" style={{ color: accent }}>
                  {character.epithet}
                </p>
                <p className="mt-1 text-xs uppercase tracking-widest" style={{ color: "#8888aa" }}>
                  Domain · {character.domain}
                </p>
              </div>

              <section className="flex flex-col gap-2 rounded-lg border p-5" style={{ borderColor: "#2a2a40" }}>
                <h3 className="text-sm font-semibold uppercase tracking-wide" style={{ color: "#FFD700" }}>
                  Starter Story
                </h3>
                <p className="text-sm leading-relaxed" style={{ color: "#d4d4e8" }}>
                  {character.starter_story}
                </p>
              </section>

              <section
                className="flex flex-col gap-2 rounded-lg border p-5"
                style={{ borderColor: "#2a2a40", background: "#13132b" }}
              >
                <h3 className="text-sm font-semibold uppercase tracking-wide" style={{ color: "#8888aa" }}>
                  🔒 Personal Dossier
                </h3>
                <p className="text-sm leading-relaxed" style={{ color: "#6b6b8a" }}>
                  There is more to your story — things only you are meant to know. This dossier
                  unlocks as the season unfolds.
                </p>
              </section>
            </div>
          </div>
        )}

        <p className="text-center text-xs" style={{ color: "#6b6b8a" }}>
          Explore the whole war in the{" "}
          <Link href="/universe" className="underline" style={{ color: "#0057FF" }}>
            UFF Universe
          </Link>
          .
        </p>
      </main>
    </div>
  );
}
