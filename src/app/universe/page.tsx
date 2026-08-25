import Link from "next/link";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import CharacterSilhouette from "@/components/CharacterSilhouette";

export const metadata: Metadata = {
  title: "The UFF Universe — Heroes & Villains",
  description:
    "Two orders locked in an endless war. Meet the twenty legends of Ultimate Fantasy Football — the Vanguard and the Dominion.",
};

interface Character {
  id: number;
  faction: "hero" | "villain";
  name: string;
  epithet: string;
  domain: string;
  starter_story: string;
  art_url: string | null;
}

function CharacterCard({ c }: { c: Character }) {
  const isHero = c.faction === "hero";
  const accent = isHero ? "#0057FF" : "#CC0000";
  return (
    <article
      className="flex flex-col gap-3 rounded-xl border p-4"
      style={{ borderColor: "#2a2a40", background: "#12121c" }}
    >
      <div className="mx-auto w-full" style={{ maxWidth: 200 }}>
        {c.art_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={c.art_url}
            alt={c.name}
            className="w-full rounded-[14px]"
            style={{ aspectRatio: "3 / 4", objectFit: "cover", border: `1px solid ${accent}55` }}
          />
        ) : (
          <CharacterSilhouette faction={c.faction} name={c.name} />
        )}
      </div>
      <div>
        <h3 className="text-xl" style={{ fontFamily: "var(--font-display, sans-serif)", color: "#FFD700" }}>
          {c.name}
        </h3>
        <p className="text-sm italic" style={{ color: accent }}>
          {c.epithet}
        </p>
        <p className="mt-1 text-[10px] uppercase tracking-widest" style={{ color: "#8888aa" }}>
          {c.domain}
        </p>
      </div>
      <p className="text-sm leading-relaxed" style={{ color: "#c4c4d8" }}>
        {c.starter_story}
      </p>
    </article>
  );
}

export default async function UniversePage() {
  const supabase = await createClient();
  const { data: characters } = await supabase
    .from("uff_characters")
    .select("id, faction, name, epithet, domain, starter_story, art_url")
    .order("id", { ascending: true })
    .returns<Character[]>();

  const heroes = (characters ?? []).filter((c) => c.faction === "hero");
  const villains = (characters ?? []).filter((c) => c.faction === "villain");

  return (
    <div className="min-h-screen" style={{ background: "#0d0d1a", color: "#f4f4f8" }}>
      {/* Nav */}
      <header className="sticky top-0 z-50 px-6 sm:px-12" style={{ background: "#0d0d1a", borderBottom: "1px solid #2a2a40" }}>
        <div className="mx-auto flex max-w-6xl items-center justify-between h-14">
          <Link href="/" className="text-2xl tracking-wider" style={{ fontFamily: "var(--font-display, sans-serif)", color: "#FFD700", letterSpacing: "0.05em" }}>
            UFF
          </Link>
          <div className="flex items-center gap-5 text-sm font-medium">
            <Link href="/about" className="hover:opacity-80">About</Link>
            <Link href="/guide" className="hover:opacity-80">Guide</Link>
            <Link href="/login" className="hover:opacity-80">Sign In</Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="px-6 sm:px-12 py-14 text-center">
        <div className="mx-auto max-w-3xl flex flex-col gap-4">
          <p className="text-sm uppercase tracking-[0.3em]" style={{ color: "#FFD700" }}>
            The UFF Universe
          </p>
          <h1 className="text-4xl sm:text-5xl" style={{ fontFamily: "var(--font-display, sans-serif)" }}>
            Two orders. One endless war.
          </h1>
          <p className="text-base leading-relaxed" style={{ color: "#a0a0c0" }}>
            When you choose a side, you aren&apos;t picking a color — you&apos;re cast as one of its
            legends. The <span style={{ color: "#0057FF" }}>Vanguard</span> holds the line. The{" "}
            <span style={{ color: "#CC0000" }}>Dominion</span> takes what others earn. Every season,
            a new class is drawn onto the field, and the story you write together becomes the canon
            the next class inherits.
          </p>
        </div>
      </section>

      {/* Vanguard */}
      <section className="px-6 sm:px-12 pb-14">
        <div className="mx-auto max-w-6xl">
          <div className="mb-6 flex items-center gap-3">
            <h2 className="text-2xl sm:text-3xl" style={{ fontFamily: "var(--font-display, sans-serif)", color: "#0057FF" }}>
              ⚔️ The Vanguard
            </h2>
            <span className="text-sm uppercase tracking-widest" style={{ color: "#8888aa" }}>Heroes · AFC</span>
          </div>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {heroes.map((c) => <CharacterCard key={c.id} c={c} />)}
          </div>
        </div>
      </section>

      {/* Dominion */}
      <section className="px-6 sm:px-12 pb-16">
        <div className="mx-auto max-w-6xl">
          <div className="mb-6 flex items-center gap-3">
            <h2 className="text-2xl sm:text-3xl" style={{ fontFamily: "var(--font-display, sans-serif)", color: "#CC0000" }}>
              🐍 The Dominion
            </h2>
            <span className="text-sm uppercase tracking-widest" style={{ color: "#8888aa" }}>Villains · NFC</span>
          </div>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {villains.map((c) => <CharacterCard key={c.id} c={c} />)}
          </div>
        </div>
      </section>

      <footer className="px-6 sm:px-12 py-8 text-center text-sm" style={{ borderTop: "1px solid #2a2a40", color: "#6b6b8a" }}>
        <Link href="/" className="underline" style={{ color: "#0057FF" }}>Ultimate Fantasy Football</Link>
        {" · "}Portraits coming soon.
      </footer>
    </div>
  );
}
