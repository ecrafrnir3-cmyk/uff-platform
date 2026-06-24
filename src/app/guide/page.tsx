import Link from "next/link";

export const metadata = {
  title: "Powers & Factions Guide | Ultimate Fantasy Football",
  description: "A complete guide to all 16 draft powers, 18 season tokens, factions, and the Hero vs Villain system in UFF.",
};

// ─── Shared components ────────────────────────────────────────────────────────
function SectionHeader({ label, title }: { label: string; title: string }) {
  return (
    <div className="mb-8">
      <p className="text-xs uppercase tracking-[0.4em] mb-2" style={{ color: "#FFD700" }}>{label}</p>
      <h2 className="text-3xl font-bold" style={{ color: "#f4f4f8" }}>{title}</h2>
    </div>
  );
}

function PowerCard({
  name,
  category,
  icon,
  description,
  tip,
  accent = "#FFD700",
}: {
  name: string;
  category: string;
  icon: string;
  description: string;
  tip?: string;
  accent?: string;
}) {
  return (
    <div className="rounded-2xl border p-5 flex flex-col gap-3"
      style={{ borderColor: `${accent}33`, background: "#13132b" }}>
      <div className="flex items-center gap-3">
        <span className="text-2xl">{icon}</span>
        <div>
          <p className="font-bold text-sm" style={{ color: accent }}>{name}</p>
          <p className="text-xs uppercase tracking-wider" style={{ color: "#f4f4f8" }}>{category}</p>
        </div>
      </div>
      <p className="text-sm leading-relaxed" style={{ color: "#f4f4f8" }}>{description}</p>
      {tip && (
        <p className="text-xs rounded-md px-3 py-2" style={{ background: "#0f0f1e", color: "#f4f4f8" }}>
          {tip}
        </p>
      )}
    </div>
  );
}

function TokenRow({ id, name, effect }: { id: number; name: string; effect: string }) {
  return (
    <div className="flex gap-4 rounded-xl border px-4 py-3 items-start"
      style={{ borderColor: "#2a2a40", background: "#13132b" }}>
      <span className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold"
        style={{ background: "#1e1e30", color: "#FFD700" }}>
        {id}
      </span>
      <div>
        <p className="text-sm font-semibold" style={{ color: "#f4f4f8" }}>{name}</p>
        <p className="text-xs mt-0.5 leading-relaxed" style={{ color: "#f4f4f8" }}>{effect}</p>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function GuidePage() {
  return (
    <div className="min-h-screen" style={{ background: "#0d0d1a", color: "#f4f4f8" }}>

      {/* ── Nav ── */}
      <nav className="sticky top-0 z-10 flex items-center justify-between px-6 py-4 border-b"
        style={{ borderColor: "#1e1e30", background: "rgba(13,13,26,0.95)", backdropFilter: "blur(8px)" }}>
        <Link href="/login" className="flex items-center gap-2">
          <span className="text-lg font-black tracking-tight" style={{ color: "#FFD700" }}>UFF</span>
          <span className="hidden sm:inline text-sm font-medium" style={{ color: "#f4f4f8" }}>Ultimate Fantasy Football</span>
        </Link>
        <div className="flex items-center gap-4">
          <Link href="/about" className="text-sm font-medium hover:underline" style={{ color: "#f4f4f8" }}>About</Link>
          <Link href="/login"
            className="rounded-md px-4 py-1.5 text-sm font-semibold"
            style={{ background: "#0057FF", color: "#f4f4f8" }}>
            Play Now
          </Link>
        </div>
      </nav>

      {/* ── Hero ── */}
      <section className="mx-auto max-w-4xl px-6 py-16 text-center">
        <p className="text-xs uppercase tracking-[0.4em] mb-3" style={{ color: "#FFD700" }}>Complete Guide</p>
        <h1 className="text-5xl font-black tracking-tight mb-4" style={{ color: "#f4f4f8" }}>
          Powers &amp; Factions
        </h1>
        <p className="text-lg max-w-2xl mx-auto" style={{ color: "#f4f4f8" }}>
          Everything you need to know — 16 draft powers, 18 season tokens, factions,
          and the Hero vs. Villain meta.
        </p>
        {/* Quick nav */}
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          {["#factions", "#draft-powers", "#tokens", "#chips"].map((href) => (
            <a key={href} href={href}
              className="rounded-full border px-4 py-1.5 text-xs font-semibold hover:opacity-80"
              style={{ borderColor: "#2a2a40", color: "#f4f4f8" }}>
              {href.replace("#", "").replace("-", " ").replace(/\b\w/g, c => c.toUpperCase())}
            </a>
          ))}
        </div>
      </section>

      {/* ── Vision ── */}
      <section className="border-y py-10 mb-16" style={{ borderColor: "#1e1e30", background: "#0f0f1e" }}>
        <div className="mx-auto max-w-3xl px-6">
          <p className="text-base leading-relaxed text-center" style={{ color: "#f4f4f8" }}>
            <span className="font-semibold" style={{ color: "#FFD700" }}>Why UFF exists:</span>{" "}
            Standard fantasy football has always rewarded the same thing — who you drafted. We wanted
            to reward <em>decisions</em>. Every round of the draft, every week of the season, there&apos;s
            an edge you can press or a mistake you can avoid. Draft powers shake up the draft board.
            Season tokens flip the outcome of close games. Factions turn your individual record into
            something bigger. UFF is still fantasy football — it&apos;s just never a foregone conclusion.
          </p>
        </div>
      </section>

      <div className="mx-auto max-w-4xl px-6 pb-24 flex flex-col gap-20">

        {/* ── Factions ── */}
        <section id="factions">
          <SectionHeader label="The meta-game" title="Factions: Hero vs. Villain" />

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
            <div className="rounded-2xl border p-6"
              style={{ borderColor: "#0057FF55", background: "rgba(0,87,255,0.06)" }}>
              <p className="text-xs uppercase tracking-wider mb-2" style={{ color: "#0057FF" }}>🛡 Heroes</p>
              <h3 className="text-xl font-bold mb-3" style={{ color: "#f4f4f8" }}>The Hero Faction</h3>
              <p className="text-sm leading-relaxed" style={{ color: "#f4f4f8" }}>
                Heroes earn roster bonuses from NFL teams designated as Hero-aligned.
                For every player on your active roster from a Hero NFL team, you earn +0.5 pts/week.
                Hero&apos;s Shield draft power protects against Draft Heist attacks. Stand for order.
              </p>
            </div>
            <div className="rounded-2xl border p-6"
              style={{ borderColor: "#CC000055", background: "rgba(204,0,0,0.06)" }}>
              <p className="text-xs uppercase tracking-wider mb-2" style={{ color: "#CC0000" }}>⚡ Villains</p>
              <h3 className="text-xl font-bold mb-3" style={{ color: "#f4f4f8" }}>The Villain Faction</h3>
              <p className="text-sm leading-relaxed" style={{ color: "#f4f4f8" }}>
                Villains earn roster bonuses from NFL teams designated as Villain-aligned.
                Same +0.5 pts per aligned roster player per week. Villains tend to get the aggressive
                draft powers: Vampire Bite, Draft Heist. Play dirty. Win anyway.
              </p>
            </div>
          </div>

          <div className="rounded-2xl border p-6 grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm"
            style={{ borderColor: "#2a2a40", background: "#13132b" }}>
            <div>
              <p className="font-semibold mb-1" style={{ color: "#FFD700" }}>Assignment</p>
              <p style={{ color: "#f4f4f8" }}>
                The commissioner assigns factions before the draft — manually or via random assignment tool.
                Balance is encouraged.
              </p>
            </div>
            <div>
              <p className="font-semibold mb-1" style={{ color: "#FFD700" }}>Roster Bonus</p>
              <p style={{ color: "#f4f4f8" }}>
                +0.5 pts per active roster player whose NFL team aligns with your faction.
                Calculated automatically each week. Faction Surge token doubles it to 1.0 pts.
              </p>
            </div>
            <div>
              <p className="font-semibold mb-1" style={{ color: "#FFD700" }}>Faction War</p>
              <p style={{ color: "#f4f4f8" }}>
                Every week, Hero wins and Villain wins are tallied in aggregate.
                The Standings page shows the Faction War record — bragging rights at the macro level.
              </p>
            </div>
          </div>
        </section>

        {/* ── Draft Powers ── */}
        <section id="draft-powers">
          <SectionHeader label="Draft day — 16 powers" title="Draft Powers" />

          <p className="text-sm mb-10" style={{ color: "#f4f4f8" }}>
            Before each of your picks, a draft power assigned to that round activates.
            Powers fall into four categories: <strong style={{color:"#FFD700"}}>Draft Mechanics</strong> that change the board,{" "}
            <strong style={{color:"#3DDC84"}}>Tied-to-Pick</strong> bonuses locked to the player you draft,{" "}
            <strong style={{color:"#CC0000"}}>Self-Cost</strong> powers that carry a penalty, and a{" "}
            <strong style={{color:"#a78bfa"}}>Season Effect</strong> that pays out every week.
          </p>

          {/* Draft Mechanics */}
          <h3 className="text-base font-bold uppercase tracking-wide mb-4" style={{ color: "#FFD700" }}>
            ⚙️ Draft Mechanics
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 mb-10">
            <PowerCard name="Foresight Coin" category="Draft Mechanic" icon="🪙"
              description="Instead of your round's dealt power, look ahead at your own next two rounds' powers and pick one to receive now. The power left behind shifts later in your order."
              tip="💡 Great for grabbing a Vampire Bite early when the draft board is richest."
              accent="#FFD700" />
            <PowerCard name="Draft Heist" category="Draft Mechanic" icon="🥷"
              description="Steal another manager's draft pick slot for this round (swap positions). They pick where you were; you pick where they were."
              tip="💡 Jump in front of a manager about to grab your target. Or strand a rival in a dead zone."
              accent="#FF6B35" />
            <PowerCard name="Hero's Shield" category="Draft Mechanic" icon="🦸"
              description="Paired with Draft Heist: when any manager is dealt Heist, a random Hero manager also receives Shield for that round. If that Hero is the Heist target, the steal is auto-blocked."
              tip="💡 Hold it quietly — it only activates if you're the target, but that block can swing a whole round."
              accent="#0057FF" />
            <PowerCard name="Telepathy" category="Draft Mechanic" icon="🧠"
              description="Instantly reveals the power held by the next manager to pick in the draft sequence. Know what's coming before they act."
              tip="💡 Most useful when you suspect a Heist or Bite is coming in a high-value round."
              accent="#0057FF" />
            <PowerCard name="Cloak" category="Draft Mechanic" icon="👤"
              description="Hides your power from the previous manager's Telepathy reveal. Anyone who checks your power sees only 'Power cloaked.'"
              tip="💡 Stack in rounds where a Bite or Heist surprise causes maximum damage."
              accent="#f4f4f8" />
          </div>

          {/* Season Effect */}
          <h3 className="text-base font-bold uppercase tracking-wide mb-4" style={{ color: "#a78bfa" }}>
            🦇 Season Effect
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 mb-10">
            <PowerCard name="Vampire Bite" category="Season Effect" icon="🦇"
              description="Pick any already-drafted player (from any team, not yet bitten). Each week for the rest of the season, 10% of that player's fantasy score is added to yours. Each player can only be bitten once."
              tip="💡 Bite an elite WR or RB early — 10% of a 40-pt week adds up to 4 bonus points, every week."
              accent="#a78bfa" />
          </div>

          {/* Tied-to-Pick */}
          <h3 className="text-base font-bold uppercase tracking-wide mb-4" style={{ color: "#3DDC84" }}>
            🔗 Tied-to-Pick Powers
          </h3>
          <p className="text-sm mb-5" style={{ color: "#f4f4f8" }}>
            These powers activate only if your pick in that round matches the required position.
            Draft the wrong position and the power fizzles — no effect.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 mb-10">
            <PowerCard name="Gunslinger" category="Tied to Pick — QB" icon="🎯"
              description="If your pick is a QB, that QB gets +1 pt per passing TD on top of league scoring, season-long. Fizzles if not a QB."
              tip="💡 Worth targeting a QB earlier than usual in a round you hold this."
              accent="#3DDC84" />
            <PowerCard name="Berserker Rage" category="Tied to Pick — RB" icon="🔥"
              description="If your pick is an RB, that RB gets +0.1 pt per rushing yard on top of league scoring, season-long. Fizzles if not an RB."
              tip="💡 On a workhorse 250-carry back, that's 25 extra pts over the season."
              accent="#3DDC84" />
            <PowerCard name="Goal Line Hammer" category="Tied to Pick — RB" icon="🔨"
              description="If your pick is an RB, that RB gets +1 pt per rushing TD on top of league scoring, season-long. Fizzles if not an RB."
              tip="💡 Stack with a goal-line vulture RB — they may score fewer yards but plenty of TDs."
              accent="#3DDC84" />
            <PowerCard name="Reception Specialist" category="Tied to Pick — WR/RB/TE" icon="🙌"
              description="If your pick is a WR, RB, or TE, that player gets +0.5 PPR on top of league scoring, season-long. Fizzles if QB, K, or D/ST."
              tip="💡 One of the most flexible tied powers — works on any skill position."
              accent="#3DDC84" />
            <PowerCard name="Red Zone Menace" category="Tied to Pick — WR" icon="🚨"
              description="If your pick is a WR, that WR gets +1 pt per receiving TD on top of league scoring, season-long. Fizzles if not a WR."
              tip="💡 Targets a WR who sees heavy red-zone usage — touchdowns multiply fast."
              accent="#3DDC84" />
            <PowerCard name="Seam Buster" category="Tied to Pick — TE" icon="⚡"
              description="If your pick is a TE, that TE gets +1 pt per receiving TD on top of league scoring, season-long. Fizzles if not a TE."
              tip="💡 A top TE who scores 8–10 TDs adds 8–10 free points on top of normal scoring."
              accent="#3DDC84" />
            <PowerCard name="Iron Defense" category="Tied to Pick — D/ST" icon="🛡️"
              description="If your pick is a D/ST, that D/ST's scoring is doubled, season-long. Fizzles if not a D/ST."
              tip="💡 An elite defense with this power is worth a starting roster spot every single week."
              accent="#3DDC84" />
            <PowerCard name="Sniper" category="Tied to Pick — K" icon="🔭"
              description="If your pick is a K, that K's field goals of 50+ yards are worth double points, season-long. Fizzles if not a K."
              tip="💡 Pair with a deep-ball kicker on a dome team. Long FGs add up."
              accent="#3DDC84" />
            <PowerCard name="Time Stone" category="Tied to Pick — Any" icon="⏳"
              description="Tied to your pick (any position — no fizzle). If that player gets injured and you keep them in your starting lineup, they continue scoring their last healthy game's total every week until they return. Benching them while injured permanently breaks the freeze."
              tip="💡 The only no-fizzle tied power. On your best player, it's insurance against season-ending injury."
              accent="#3DDC84" />
          </div>

          {/* Self Cost */}
          <h3 className="text-base font-bold uppercase tracking-wide mb-4" style={{ color: "#CC0000" }}>
            ⚠️ Self-Cost Powers
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <PowerCard name="Power Negation" category="Self-Cost" icon="❌"
              description="The player you draft this round has their fantasy scoring halved, season-long — until you or a teammate restores them with a Power Restore Chip. This is a cost power, not a benefit."
              tip="⚠️ If you pull this, draft a throwaway pick for this round — don't waste a top target."
              accent="#CC0000" />
          </div>
        </section>

        {/* ── Season Tokens ── */}
        <section id="tokens">
          <SectionHeader label="Every week — 18 tokens" title="Season Tokens" />

          <p className="text-sm mb-8" style={{ color: "#f4f4f8" }}>
            Each week, every manager receives one of 18 possible season tokens.
            Tokens lock in before games start, reveal after the lock window, and can only be used once
            (except Second Wind). The right token at the right moment can turn a 4-point deficit into a win.
          </p>

          <div className="flex flex-col gap-3">
            <TokenRow id={1} name="Power Surge" effect="+2.0 flat points added to your total score this week. Simple, reliable, and most valuable in tight matchups." />
            <TokenRow id={2} name="Triple Threat" effect="Your kicker's actual points are tripled this week. In a big kicker week (field goals galore), this can be +8 to +12 pts." />
            <TokenRow id={3} name="Bench Vault" effect="Your highest-scoring bench player's points are added on top of your starter total — a free extra contributor, no swap needed." />
            <TokenRow id={4} name="Mulligan" effect="After all games finish, your worst-performing starter is retroactively swapped with the highest-scoring eligible bench player who outscored them. A safety net for a bust start." />
            <TokenRow id={5} name="Mirror Match" effect="Your score gains a bonus equal to the total extra points your opponent's active draft powers generated for them this week. If they benefited, you match it." />
            <TokenRow id={6} name="Faction Surge" effect="Doubles your weekly faction roster bonus — from +0.5 pts/aligned player to +1.0. In a full roster of aligned players, that's a 15–20 pt swing." />
            <TokenRow id={7} name="Position Power" effect="Choose a position (QB, RB, WR, TE, K, DEF). Your top-scoring starter at that position gets 1.5x their points this week." />
            <TokenRow id={8} name="Fortress" effect="Your D/ST score is doubled this week. A shutout or pick-six game becomes a point explosion. High variance, high ceiling." />
            <TokenRow id={9} name="Recon" effect="Reveals your opponent's weekly token selection before the normal lock-and-reveal window. Know what you're up against and adjust your lineup accordingly." />
            <TokenRow id={10} name="Air Raid" effect="+1.0 extra point per passing touchdown for your QB(s) this week. Stack with a high-volume passer in a shootout game for maximum return." />
            <TokenRow id={11} name="Insurance" effect="If you lose this week, the loss doesn't count toward your record — logged as a no-contest. Your record stays clean. Your opponent's win still counts for them." />
            <TokenRow id={12} name="Last Stand" effect="If you trail by 20+ points after all players are locked, all of your bench players' points are retroactively added to your score. A big-deficit comeback mechanism." />
            <TokenRow id={13} name="Quick Feet" effect="Grants one late injury swap after games have started for the week. Move a locked injured player off your lineup without losing the game-time lock window on your replacement." />
            <TokenRow id={14} name="Momentum" effect="If you're currently on a 2+ game win streak, +1.5 pts are added to your score this week. Rewards running hot." />
            <TokenRow id={15} name="Underdog" effect="If you lose this week, +3 pts are added to your final score as a consolation bonus. It doesn't flip the result — but it helps in tiebreaker scenarios." />
            <TokenRow id={16} name="Iron Will" effect="Your starter with the lowest pre-game projected score this week gets 2x their actual points. High-risk, high-reward on a sleeper or a desperate plug-in." />
            <TokenRow id={17} name="Clutch Gene" effect="If your matchup is decided by 5 points or fewer, your score is rounded up by 1 full point. A quiet weapon — you won't always need it, but when you do, it wins games." />
            <TokenRow id={18} name="Second Wind" effect="Reuse any one weekly token you've already used earlier this season. The only token that can be used twice. Save it for the playoffs." />
          </div>
        </section>

        {/* ── Power Restore Chips ── */}
        <section id="chips">
          <SectionHeader label="Bonus" title="Power Restore Chips" />
          <div className="rounded-2xl border p-6" style={{ borderColor: "#0057FF55", background: "rgba(0,87,255,0.06)" }}>
            <p className="text-sm leading-relaxed" style={{ color: "#f4f4f8" }}>
              The manager with the highest score in the league each week earns a{" "}
              <span className="font-semibold" style={{ color: "#0057FF" }}>Power Restore Chip</span>.
              Chips restore a player whose scoring was halved by a Power Negation draft power,
              returning them to full scoring. Chips can be held and traded strategically.
              High scorers earn them; smart managers spend them wisely.
            </p>
          </div>
        </section>

        {/* ── CTA ── */}
        <section className="text-center">
          <h2 className="text-3xl font-bold mb-4" style={{ color: "#FFD700" }}>Ready to Play?</h2>
          <p className="text-base mb-8" style={{ color: "#f4f4f8" }}>
            Season 1 kicks off September 2026. Get your league together and see how deep the strategy goes.
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            <Link href="/login"
              className="rounded-lg px-6 py-3 text-sm font-bold"
              style={{ background: "#FFD700", color: "#0d0d1a" }}>
              Start a League
            </Link>
            <Link href="/about"
              className="rounded-lg px-6 py-3 text-sm font-semibold border"
              style={{ borderColor: "#2a2a40", color: "#f4f4f8" }}>
              About UFF
            </Link>
          </div>
        </section>

      </div>

      {/* ── Footer ── */}
      <footer className="border-t py-8 text-center" style={{ borderColor: "#1e1e30" }}>
        <p className="text-xs" style={{ color: "#f4f4f8" }}>
          &copy; 2026 Ultimate Fantasy Football &middot;{" "}
          <Link href="/about" className="hover:underline" style={{ color: "#f4f4f8" }}>About</Link>
          {" "}&middot;{" "}
          <Link href="/login" className="hover:underline" style={{ color: "#f4f4f8" }}>Sign In</Link>
        </p>
      </footer>

    </div>
  );
}
