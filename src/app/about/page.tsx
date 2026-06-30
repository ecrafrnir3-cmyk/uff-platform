import Link from "next/link";

export const metadata = {
  title: "About UFF | Ultimate Fantasy Football",
  description: "What is Ultimate Fantasy Football and what makes it different from Yahoo, ESPN, and Sleeper.",
};

export default function AboutPage() {
  return (
    <div className="min-h-screen" style={{ background: "#0d0d1a", color: "#f4f4f8" }}>

      {/* ── Nav Bar ── */}
      <nav className="sticky top-0 z-10 flex items-center justify-between px-6 py-4 border-b"
        style={{ borderColor: "#1e1e30", background: "rgba(13,13,26,0.95)", backdropFilter: "blur(8px)" }}>
        <Link href="/login" className="flex items-center gap-2">
          <span className="text-lg font-black tracking-tight" style={{ color: "#FFD700" }}>UFF</span>
          <span className="hidden sm:inline text-sm font-medium" style={{ color: "#f4f4f8" }}>Ultimate Fantasy Football</span>
        </Link>
        <div className="flex items-center gap-4">
          <Link href="/guide" className="text-sm font-medium hover:underline" style={{ color: "#f4f4f8" }}>
            Powers &amp; Guide
          </Link>
          <Link href="/login"
            className="rounded-md px-4 py-1.5 text-sm font-semibold"
            style={{ background: "#0057FF", color: "#f4f4f8" }}>
            Play Now
          </Link>
        </div>
      </nav>

      {/* ── Hero ── */}
      <section className="mx-auto max-w-4xl px-6 py-20 text-center">
        <p className="text-xs uppercase tracking-[0.4em] mb-3" style={{ color: "#FFD700" }}>
          Welcome to the arena
        </p>
        <h1 className="text-5xl sm:text-6xl font-black tracking-tight mb-6" style={{ color: "#f4f4f8" }}>
          Fantasy Football,{" "}
          <span style={{
            background: "linear-gradient(135deg, #0057FF, #FFD700)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
          }}>
            Re-imagined
          </span>
        </h1>
        <p className="text-lg max-w-2xl mx-auto" style={{ color: "#f4f4f8" }}>
          UFF takes everything you love about fantasy football and layers on a strategic meta-game
          of draft powers, season tokens, and faction warfare — turning every week into a storyline.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link href="/login"
            className="rounded-lg px-6 py-3 text-sm font-bold"
            style={{ background: "#FFD700", color: "#0d0d1a" }}>
            Start a League
          </Link>
          <Link href="/guide"
            className="rounded-lg px-6 py-3 text-sm font-semibold border"
            style={{ borderColor: "#2a2a40", color: "#f4f4f8" }}>
            Read the Guide
          </Link>
        </div>
      </section>

      {/* ── What Makes UFF Different ── */}
      <section className="mx-auto max-w-4xl px-6 pb-20">
        <h2 className="text-3xl font-bold text-center mb-12" style={{ color: "#FFD700" }}>
          What Makes UFF Unique
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">

          {/* Card 1 */}
          <div className="rounded-2xl border p-6 flex flex-col gap-3"
            style={{ borderColor: "#1e1e30", background: "#13132b" }}>
            <div className="text-3xl">⚡</div>
            <h3 className="text-base font-bold" style={{ color: "#FFD700" }}>Draft Powers</h3>
            <p className="text-sm leading-relaxed" style={{ color: "#f4f4f8" }}>
              Every round of the draft opens with a 30-second pre-round buffer where powers like
              Draft Heist and Telepathy activate — steal pick slots, read opponents, and shape the
              round before a single pick drops. Then your hidden power fires when you pick.
            </p>
          </div>

          {/* Card 2 */}
          <div className="rounded-2xl border p-6 flex flex-col gap-3"
            style={{ borderColor: "#1e1e30", background: "#13132b" }}>
            <div className="text-3xl">🃏</div>
            <h3 className="text-base font-bold" style={{ color: "#FFD700" }}>18 Season Tokens</h3>
            <p className="text-sm leading-relaxed" style={{ color: "#f4f4f8" }}>
              Each week managers unlock a token — Power Surge, Mulligan, Insurance, Last Stand, and 14 more.
              Use it right and one decision can flip a loss to a win.
            </p>
          </div>

          {/* Card 3 */}
          <div className="rounded-2xl border p-6 flex flex-col gap-3"
            style={{ borderColor: "#0057FF", background: "rgba(0,87,255,0.06)" }}>
            <div className="text-3xl">🛡</div>
            <h3 className="text-base font-bold" style={{ color: "#0057FF" }}>Hero vs. Villain</h3>
            <p className="text-sm leading-relaxed" style={{ color: "#f4f4f8" }}>
              Every manager is assigned a faction at the start of the season. Hero or Villain — and
              your real NFL players' teams determine your weekly roster bonus. It&apos;s personal now.
            </p>
          </div>

          {/* Card 4 */}
          <div className="rounded-2xl border p-6 flex flex-col gap-3"
            style={{ borderColor: "#1e1e30", background: "#13132b" }}>
            <div className="text-3xl">🎯</div>
            <h3 className="text-base font-bold" style={{ color: "#FFD700" }}>Full Scoring Control</h3>
            <p className="text-sm leading-relaxed" style={{ color: "#f4f4f8" }}>
              Commissioners set every scoring weight — PPR, half-PPR, standard, or fully custom.
              No locked presets, no hidden multipliers.
            </p>
          </div>

          {/* Card 5 */}
          <div className="rounded-2xl border p-6 flex flex-col gap-3"
            style={{ borderColor: "#1e1e30", background: "#13132b" }}>
            <div className="text-3xl">🔒</div>
            <h3 className="text-base font-bold" style={{ color: "#FFD700" }}>No Ads. No Algorithm.</h3>
            <p className="text-sm leading-relaxed" style={{ color: "#f4f4f8" }}>
              UFF doesn&apos;t sell ad space, doesn&apos;t push sponsored content, and doesn&apos;t
              bury the game under upsells. Just the league. Just your managers.
            </p>
          </div>

          {/* Card 6 */}
          <div className="rounded-2xl border p-6 flex flex-col gap-3"
            style={{ borderColor: "#CC0000", background: "rgba(204,0,0,0.06)" }}>
            <div className="text-3xl">⚔️</div>
            <h3 className="text-base font-bold" style={{ color: "#CC0000" }}>Faction War</h3>
            <p className="text-sm leading-relaxed" style={{ color: "#f4f4f8" }}>
              Beyond individual records, Heroes and Villains fight for aggregate dominance every week.
              Your faction&apos;s W/L and points stack up — losing alone still means fighting for your side.
            </p>
          </div>

        </div>
      </section>

      {/* ── Honest Differences ── */}
      <section className="border-y py-20" style={{ borderColor: "#1e1e30", background: "#0f0f1e" }}>
        <div className="mx-auto max-w-3xl px-6">
          <h2 className="text-3xl font-bold mb-3" style={{ color: "#f4f4f8" }}>
            What to Expect vs. the Big Platforms
          </h2>
          <p className="text-sm mb-10" style={{ color: "#f4f4f8" }}>
            We believe in being straight with you. UFF is independent, early-stage, and built to earn your trust —
            so here&apos;s an honest look at where we stand.
          </p>

          <div className="flex flex-col gap-6">

            <div className="rounded-xl border p-5" style={{ borderColor: "#2a2a40", background: "#13132b" }}>
              <div className="flex items-start gap-4">
                <span className="text-2xl mt-0.5">⏱</span>
                <div>
                  <h3 className="font-bold mb-1" style={{ color: "#FFD700" }}>Live Scores Refresh Every ~15 Minutes</h3>
                  <p className="text-sm leading-relaxed" style={{ color: "#f4f4f8" }}>
                    On game days, scores update approximately every 15 minutes through our automated scoring engine.
                    Yahoo and ESPN offer near-real-time feeds. Ours runs on a schedule — you won&apos;t see a play-by-play,
                    but you&apos;ll never miss a score cycle either.
                    <span className="block mt-2 text-xs" style={{ color: "#f4f4f8" }}>
                      Future seasons: We plan to integrate live scoring feeds that close this gap significantly.
                    </span>
                  </p>
                </div>
              </div>
            </div>

            <div className="rounded-xl border p-5" style={{ borderColor: "#2a2a40", background: "#13132b" }}>
              <div className="flex items-start gap-4">
                <span className="text-2xl mt-0.5">📱</span>
                <div>
                  <h3 className="font-bold mb-1" style={{ color: "#FFD700" }}>Web-Only Right Now</h3>
                  <p className="text-sm leading-relaxed" style={{ color: "#f4f4f8" }}>
                    UFF is a mobile-optimized web app but it&apos;s not in the App Store or Google Play yet.
                    You can add it to your home screen and it works great — but it&apos;s not a native app.
                    <span className="block mt-2 text-xs" style={{ color: "#f4f4f8" }}>
                      Future seasons: Native iOS and Android apps are on the roadmap.
                    </span>
                  </p>
                </div>
              </div>
            </div>

            <div className="rounded-xl border p-5" style={{ borderColor: "#2a2a40", background: "#13132b" }}>
              <div className="flex items-start gap-4">
                <span className="text-2xl mt-0.5">📰</span>
                <div>
                  <h3 className="font-bold mb-1" style={{ color: "#FFD700" }}>No Built-In Expert Analysis</h3>
                  <p className="text-sm leading-relaxed" style={{ color: "#f4f4f8" }}>
                    Yahoo and ESPN have armies of analysts producing daily content. UFF surfaces NFL headlines from ESPN
                    and projects player points based on Sleeper data, but we don&apos;t have our own editorial team.
                    We&apos;re the arena — bring your own research.
                    <span className="block mt-2 text-xs" style={{ color: "#f4f4f8" }}>
                      Future seasons: Deeper player insights, news integration, and AI-assisted waiver recommendations.
                    </span>
                  </p>
                </div>
              </div>
            </div>

            <div className="rounded-xl border p-5" style={{ borderColor: "#2a2a40", background: "#13132b" }}>
              <div className="flex items-start gap-4">
                <span className="text-2xl mt-0.5">🧩</span>
                <div>
                  <h3 className="font-bold mb-1" style={{ color: "#FFD700" }}>Fewer Third-Party Integrations</h3>
                  <p className="text-sm leading-relaxed" style={{ color: "#f4f4f8" }}>
                    UFF doesn&apos;t plug into DraftKings, NFL.com, or other external tools yet.
                    No prize wallet, no best-ball import, no cross-platform syncing.
                    <span className="block mt-2 text-xs" style={{ color: "#f4f4f8" }}>
                      Future seasons: Third-party integrations, prize pool options, and cross-league tools.
                    </span>
                  </p>
                </div>
              </div>
            </div>

          </div>
        </div>
      </section>

      {/* ── Vision ── */}
      <section className="mx-auto max-w-3xl px-6 py-20 text-center">
        <p className="text-xs uppercase tracking-[0.4em] mb-3" style={{ color: "#FFD700" }}>
          The road ahead
        </p>
        <h2 className="text-3xl font-bold mb-6" style={{ color: "#f4f4f8" }}>
          Built to Grow With You
        </h2>
        <p className="text-base leading-relaxed mb-4" style={{ color: "#f4f4f8" }}>
          UFF launched as a passion project to fix what felt broken about modern fantasy — too passive,
          too commercial, not enough decisions that matter. The powers system, factions, and tokens
          are just the beginning.
        </p>
        <p className="text-base leading-relaxed mb-8" style={{ color: "#f4f4f8" }}>
          Future seasons will bring a live scoring engine, native apps, more powers, pick-em contests,
          deeper player analytics, and a meta-game that grows more layered every year.
          The entertainment value of what&apos;s coming will far outpace anything you can get from
          the platforms that treat your league like a number.
        </p>
        <div className="inline-flex items-center gap-3 rounded-2xl border px-6 py-4"
          style={{ borderColor: "#FFD700", background: "rgba(255,215,0,0.05)" }}>
          <span className="text-2xl">🏆</span>
          <p className="text-sm font-semibold" style={{ color: "#FFD700" }}>
            September 2026 — Season 1 kicks off.
          </p>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="border-t py-8 text-center" style={{ borderColor: "#1e1e30" }}>
        <p className="text-xs" style={{ color: "#f4f4f8" }}>
          &copy; 2026 Ultimate Fantasy Football &middot;{" "}
          <Link href="/guide" className="hover:underline" style={{ color: "#f4f4f8" }}>Powers &amp; Guide</Link>
          {" "}&middot;{" "}
          <Link href="/login" className="hover:underline" style={{ color: "#f4f4f8" }}>Sign In</Link>
        </p>
      </footer>

    </div>
  );
}
