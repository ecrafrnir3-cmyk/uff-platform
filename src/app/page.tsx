import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export const metadata = {
  title: "Ultimate Fantasy Football — Draft Powers, Faction War, Oracle AI",
  description:
    "UFF is the fantasy football platform with draft powers, 18 season tokens, hero vs villain faction war, and Oracle AI recaps. Season 1 starts September 2026.",
};

export default async function LandingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Logged-in users go straight to the app
  if (user) redirect("/dashboard");

  return (
    <div className="min-h-screen" style={{ background: "#0d0d1a", color: "#f4f4f8" }}>

      {/* ── Nav ── */}
      <nav
        className="sticky top-0 z-40 flex items-center justify-between px-6 py-4 border-b"
        style={{ borderColor: "#1e1e30", background: "rgba(13,13,26,0.95)", backdropFilter: "blur(8px)" }}
      >
        <div className="flex items-center gap-2">
          <span className="text-xl font-black tracking-tight" style={{ color: "#FFD700" }}>UFF</span>
          <span className="hidden sm:inline text-sm font-medium opacity-60">Ultimate Fantasy Football</span>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/about" className="hidden sm:inline text-sm font-medium hover:underline" style={{ color: "#d4d4e8" }}>
            About
          </Link>
          <Link href="/guide" className="hidden sm:inline text-sm font-medium hover:underline" style={{ color: "#d4d4e8" }}>
            Powers &amp; Guide
          </Link>
          <Link href="/universe" className="hidden sm:inline text-sm font-medium hover:underline" style={{ color: "#d4d4e8" }}>
            Universe
          </Link>
          <Link
            href="/login"
            className="text-sm font-medium hover:underline"
            style={{ color: "#f4f4f8" }}
          >
            Sign In
          </Link>
          <Link
            href="/login?mode=signup"
            className="rounded-lg px-4 py-1.5 text-sm font-bold"
            style={{ background: "#FFD700", color: "#0d0d1a" }}
          >
            Start Your League
          </Link>
        </div>
      </nav>

      {/* ── Hero ── */}
      <section className="relative mx-auto max-w-5xl px-6 pt-24 pb-20 text-center overflow-hidden">
        {/* Background glow */}
        <div
          className="pointer-events-none absolute inset-0 -z-10"
          style={{
            background:
              "radial-gradient(ellipse 80% 50% at 50% 0%, rgba(0,87,255,0.12) 0%, transparent 70%), radial-gradient(ellipse 50% 40% at 80% 60%, rgba(204,0,0,0.08) 0%, transparent 70%)",
          }}
        />

        <p className="text-xs uppercase tracking-[0.4em] mb-4" style={{ color: "#FFD700" }}>
          Season 1 &mdash; September 2026
        </p>

        <h1 className="text-5xl sm:text-7xl font-black tracking-tight leading-tight mb-6">
          Fantasy Football<br />
          <span
            style={{
              background: "linear-gradient(135deg, #0057FF 0%, #FFD700 60%, #CC0000 100%)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
            }}
          >
            with a Meta-Game
          </span>
        </h1>

        <p className="text-lg sm:text-xl max-w-2xl mx-auto mb-3" style={{ color: "#d4d4e8" }}>
          Draft powers. 18 weekly tokens. Hero vs. Villain faction war. Oracle AI recaps.
          <br className="hidden sm:block" />
          Every week is a storyline. Every decision matters more.
        </p>
        <p className="text-sm mb-10" style={{ color: "#6b6b8a" }}>
          Built for leagues that want more than a spreadsheet.
        </p>

        <div className="flex flex-wrap justify-center gap-3">
          <Link
            href="/login?mode=signup"
            className="rounded-xl px-8 py-3.5 text-base font-bold shadow-lg"
            style={{ background: "#FFD700", color: "#0d0d1a" }}
          >
            Start Your League — Free
          </Link>
          <Link
            href="/guide"
            className="rounded-xl px-8 py-3.5 text-base font-semibold border"
            style={{ borderColor: "#2a2a40", color: "#f4f4f8" }}
          >
            Read the Powers Guide
          </Link>
        </div>

        {/* Season badge */}
        <div className="mt-12 inline-flex items-center gap-2 rounded-full border px-4 py-1.5"
          style={{ borderColor: "#2a2a40", background: "rgba(255,215,0,0.04)" }}>
          <span className="h-2 w-2 rounded-full animate-pulse" style={{ background: "#3DDC84" }} />
          <span className="text-xs font-medium" style={{ color: "#d4d4e8" }}>
            Draft day: September 2026 &nbsp;&middot;&nbsp; Season 1 opens
          </span>
        </div>
      </section>

      {/* ── The 4 Big Differentiators ── */}
      <section className="mx-auto max-w-5xl px-6 pb-24">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">

          {/* Draft Powers */}
          <div className="rounded-2xl border p-7 flex flex-col gap-4"
            style={{ borderColor: "#2a2a40", background: "#0f0f1e" }}>
            <div className="flex items-center gap-3">
              <span className="text-3xl">⚡</span>
              <h2 className="text-lg font-bold" style={{ color: "#FFD700" }}>16 Draft Powers</h2>
            </div>
            <p className="text-sm leading-relaxed" style={{ color: "#d4d4e8" }}>
              Every round has a hidden power — Vampire Bite to siphon an opponent&apos;s player score,
              Shadow Guard to permanently protect your pick, Draft Heist to steal a pick slot before
              the round begins, Telepathy to read what&apos;s coming next. Strategy starts before
              your first pick drops.
            </p>
            <div className="flex flex-wrap gap-2 mt-1">
              {["Vampire Bite","Shadow Guard","Draft Heist","Telepathy","Gunslinger","Foresight Coin"].map(p => (
                <span key={p} className="rounded-full px-2.5 py-0.5 text-xs font-medium"
                  style={{ background: "rgba(255,215,0,0.08)", color: "#FFD700", border: "1px solid rgba(255,215,0,0.2)" }}>
                  {p}
                </span>
              ))}
              <span className="rounded-full px-2.5 py-0.5 text-xs font-medium"
                style={{ background: "rgba(255,215,0,0.04)", color: "#6b6b8a", border: "1px solid #2a2a40" }}>
                +10 more
              </span>
            </div>
          </div>

          {/* Faction War */}
          <div className="rounded-2xl border p-7 flex flex-col gap-4 relative overflow-hidden"
            style={{ borderColor: "#2a2a40", background: "#0f0f1e" }}>
            <div
              className="pointer-events-none absolute inset-0 -z-0"
              style={{
                background: "linear-gradient(135deg, rgba(0,87,255,0.06) 0%, transparent 50%, rgba(204,0,0,0.06) 100%)",
              }}
            />
            <div className="relative flex items-center gap-3">
              <span className="text-3xl">⚔️</span>
              <h2 className="text-lg font-bold" style={{ color: "#f4f4f8" }}>Hero vs. Villain</h2>
            </div>
            <p className="text-sm leading-relaxed relative" style={{ color: "#d4d4e8" }}>
              Every manager is assigned a faction. Your real NFL players&apos; teams determine
              your weekly roster bonus — AFC teams boost Heroes, NFC teams boost Villains.
              Beyond your personal record, your faction fights for aggregate dominance.
              Losing individually still means something for your side.
            </p>
            <div className="relative flex gap-3 mt-1">
              <div className="flex-1 rounded-xl p-3 text-center"
                style={{ background: "rgba(0,87,255,0.1)", border: "1px solid rgba(0,87,255,0.25)" }}>
                <div className="text-lg font-black" style={{ color: "#0057FF" }}>🛡️ Heroes</div>
                <div className="text-xs mt-0.5" style={{ color: "#d4d4e8" }}>AFC roster bonus</div>
              </div>
              <div className="flex-1 rounded-xl p-3 text-center"
                style={{ background: "rgba(204,0,0,0.1)", border: "1px solid rgba(204,0,0,0.25)" }}>
                <div className="text-lg font-black" style={{ color: "#CC0000" }}>💀 Villains</div>
                <div className="text-xs mt-0.5" style={{ color: "#d4d4e8" }}>NFC roster bonus</div>
              </div>
            </div>
          </div>

          {/* 18 Season Tokens */}
          <div className="rounded-2xl border p-7 flex flex-col gap-4"
            style={{ borderColor: "#2a2a40", background: "#0f0f1e" }}>
            <div className="flex items-center gap-3">
              <span className="text-3xl">🃏</span>
              <h2 className="text-lg font-bold" style={{ color: "#FFD700" }}>18 Weekly Tokens</h2>
            </div>
            <p className="text-sm leading-relaxed" style={{ color: "#d4d4e8" }}>
              Every week you unlock a token — Power Surge, Mulligan, Insurance, Last Stand, Mirror Match,
              and 13 more. Deploy it right and one decision can flip a loss to a win. Deploy it wrong
              and your opponent watches you waste your best card.
            </p>
            <div className="mt-1 rounded-xl p-3"
              style={{ background: "rgba(255,215,0,0.04)", border: "1px solid rgba(255,215,0,0.12)" }}>
              <p className="text-xs" style={{ color: "#d4d4e8" }}>
                <span style={{ color: "#FFD700" }}>Token 9 — Recon:</span>{" "}
                Reveals your opponent&apos;s token before they play it. Intelligence is its own power.
              </p>
            </div>
          </div>

          {/* Oracle AI */}
          <div className="rounded-2xl border p-7 flex flex-col gap-4"
            style={{ borderColor: "#2a2a40", background: "#0f0f1e" }}>
            <div className="flex items-center gap-3">
              <span className="text-3xl">🔮</span>
              <h2 className="text-lg font-bold" style={{ color: "#FFD700" }}>Oracle AI</h2>
            </div>
            <p className="text-sm leading-relaxed" style={{ color: "#d4d4e8" }}>
              Before every matchup, the Oracle previews the battle. After the final whistle, it delivers
              a full recap — scoring breakdowns, storylines, who choked, who delivered.
              AI-powered power rankings, trade evaluations, start/sit advice, and a weekly newsletter
              emailed to every manager.
            </p>
            <div className="mt-1 flex flex-wrap gap-2">
              {["Matchup Preview","Post-Game Recap","Power Rankings","Trade Evaluator","Waiver Intel","Weekly Newsletter"].map(f => (
                <span key={f} className="rounded-full px-2.5 py-0.5 text-xs"
                  style={{ background: "rgba(255,215,0,0.06)", color: "#d4d4e8", border: "1px solid #2a2a40" }}>
                  {f}
                </span>
              ))}
            </div>
          </div>

        </div>
      </section>

      {/* ── Platform Features Strip ── */}
      <section className="border-y py-16" style={{ borderColor: "#1e1e30", background: "#0a0a18" }}>
        <div className="mx-auto max-w-5xl px-6">
          <p className="text-center text-xs uppercase tracking-[0.3em] mb-10" style={{ color: "#6b6b8a" }}>
            Everything else a real league needs
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 text-center">
            {[
              { icon: "🏈", label: "Live Scoring" },
              { icon: "📋", label: "Waivers + FAAB" },
              { icon: "🔄", label: "Trade Center" },
              { icon: "🏆", label: "Playoff Bracket" },
              { icon: "📱", label: "Mobile PWA" },
              { icon: "📊", label: "Record Book" },
            ].map(({ icon, label }) => (
              <div key={label} className="flex flex-col items-center gap-2 rounded-xl border p-4"
                style={{ borderColor: "#1e1e30", background: "#0f0f1e" }}>
                <span className="text-2xl">{icon}</span>
                <span className="text-xs font-medium" style={{ color: "#d4d4e8" }}>{label}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Season Titles Teaser ── */}
      <section className="mx-auto max-w-4xl px-6 py-24 text-center">
        <p className="text-xs uppercase tracking-[0.4em] mb-3" style={{ color: "#6b6b8a" }}>
          End of Season
        </p>
        <h2 className="text-3xl sm:text-4xl font-black tracking-tight mb-4" style={{ color: "#f4f4f8" }}>
          Your faction follows you to the end.
        </h2>
        <p className="text-base max-w-xl mx-auto mb-10" style={{ color: "#d4d4e8" }}>
          When the season ends, your title reflects who you were. Champions earn faction-specific glory.
          Runners-up earn a rival&apos;s respect.
        </p>
        <div className="flex flex-wrap justify-center gap-3">
          {[
            { title: "🏆 Super Hero",    color: "#FFD700",  bg: "rgba(255,215,0,0.08)",   border: "rgba(255,215,0,0.25)" },
            { title: "👑 Super Villain", color: "#CC0000",  bg: "rgba(204,0,0,0.1)",     border: "rgba(204,0,0,0.3)" },
            { title: "⚔️ Nemesis",       color: "#ff6b35",  bg: "rgba(255,107,53,0.08)",  border: "rgba(255,107,53,0.25)" },
            { title: "🦸 Side Kick",     color: "#0057FF",  bg: "rgba(0,87,255,0.08)",    border: "rgba(0,87,255,0.25)" },
            { title: "🦹 Henchman",      color: "#8855ff",  bg: "rgba(136,85,255,0.08)",  border: "rgba(136,85,255,0.25)" },
            { title: "🎭 Cast",          color: "#6b6b8a",  bg: "rgba(107,107,138,0.08)", border: "rgba(107,107,138,0.25)" },
          ].map(({ title, color, bg, border }) => (
            <span key={title}
              className="rounded-full px-4 py-1.5 text-sm font-bold"
              style={{ background: bg, color, border: `1px solid ${border}` }}>
              {title}
            </span>
          ))}
        </div>
      </section>

      {/* ── Final CTA ── */}
      <section className="border-t py-24 text-center" style={{ borderColor: "#1e1e30", background: "#090915" }}>
        <div className="mx-auto max-w-xl px-6">
          <p className="text-xs uppercase tracking-[0.4em] mb-3" style={{ color: "#FFD700" }}>
            Ready?
          </p>
          <h2 className="text-4xl font-black tracking-tight mb-4" style={{ color: "#f4f4f8" }}>
            Your league. Your faction.<br />Your legacy.
          </h2>
          <p className="text-base mb-8" style={{ color: "#d4d4e8" }}>
            Free to start. No ads. No pay-to-win. Just the game.
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            <Link
              href="/login?mode=signup"
              className="rounded-xl px-8 py-3.5 text-base font-bold"
              style={{ background: "#FFD700", color: "#0d0d1a" }}
            >
              Create Your League
            </Link>
            <Link
              href="/login"
              className="rounded-xl px-8 py-3.5 text-base font-semibold border"
              style={{ borderColor: "#2a2a40", color: "#f4f4f8" }}
            >
              Sign In
            </Link>
          </div>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="border-t py-8 text-center" style={{ borderColor: "#1e1e30" }}>
        <p className="text-xs" style={{ color: "#6b6b8a" }}>
          &copy; 2026 Ultimate Fantasy Football &nbsp;&middot;&nbsp;{" "}
          <Link href="/about" className="hover:underline" style={{ color: "#6b6b8a" }}>About</Link>
          &nbsp;&middot;&nbsp;{" "}
          <Link href="/guide" className="hover:underline" style={{ color: "#6b6b8a" }}>Powers &amp; Guide</Link>
          &nbsp;&middot;&nbsp;{" "}
          <Link href="/login" className="hover:underline" style={{ color: "#6b6b8a" }}>Sign In</Link>
        </p>
      </footer>

    </div>
  );
}
