import { rankName, RANK_THRESHOLDS, ULTIMATE_UNLOCK_RANK, type Faction } from "@/lib/story-engine/rules";

export interface LegendData {
  legend_points: number;
  rank: number;
  decline_state: string;
  earned_epithets: string[];
  attr_strike: number;
  attr_guard: number;
  attr_burst: number;
  attr_nerve: number;
  attr_omen: number;
  week_surge: number;
  ultimate_unlocked: boolean;
  ultimate_used_week: number | null;
}
export interface PowerChar {
  name: string;
  signature_name: string | null;
  signature_effect: string | null;
  ultimate_name: string | null;
  ultimate_effect: string | null;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export default function PowerSheet({
  character,
  legend,
  faction,
}: {
  character: PowerChar;
  legend: LegendData | null;
  faction: Faction;
}) {
  const isHero = faction === "hero";
  const accent = isHero ? "#0057FF" : "#CC0000";
  const gold = "#FFD700";

  const lp = legend?.legend_points ?? 0;
  const rank = legend?.rank ?? 0;
  const decline = legend?.decline_state ?? "stable";
  const declining = decline !== "stable";
  const rankLabel = declining ? cap(decline) : rankName(rank, faction);

  const prev = rank > 0 ? RANK_THRESHOLDS[rank - 1] : 0;
  const next = rank < 5 ? RANK_THRESHOLDS[rank] : null;
  const pct = next ? Math.max(0, Math.min(100, ((lp - prev) / (next - prev)) * 100)) : 100;

  const attrs: [string, number][] = [
    ["STRIKE", legend?.attr_strike ?? 0],
    ["GUARD", legend?.attr_guard ?? 0],
    ["BURST", legend?.attr_burst ?? 0],
    ["NERVE", legend?.attr_nerve ?? 0],
    ["OMEN", legend?.attr_omen ?? 0],
  ];
  const attrMax = Math.max(5, ...attrs.map(([, v]) => v));

  const ultReady = !!legend?.ultimate_unlocked && legend?.ultimate_used_week == null;
  const ultStatus =
    legend?.ultimate_used_week != null
      ? `Spent · Week ${legend.ultimate_used_week}`
      : legend?.ultimate_unlocked
        ? "Ready to unleash"
        : `Locked · rank ${ULTIMATE_UNLOCK_RANK}`;

  return (
    <section className="flex flex-col gap-4 rounded-lg border p-5" style={{ borderColor: accent + "55", background: "#101024" }}>
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-wide" style={{ color: gold }}>
          ⚔ Power Sheet
        </h3>
        {legend?.week_surge ? (
          <span className="text-xs font-semibold" style={{ color: gold }}>
            ▲ +{legend.week_surge} this week
          </span>
        ) : null}
      </div>

      {/* Rank + Legend */}
      <div className="flex flex-wrap items-end gap-x-5 gap-y-2">
        <div>
          <div className="text-[10px] uppercase tracking-widest" style={{ color: "#8888aa" }}>
            Rank
          </div>
          <div className="text-2xl font-bold" style={{ color: declining ? "#cc9977" : accent, fontFamily: "var(--font-display, sans-serif)" }}>
            {rankLabel}
          </div>
        </div>
        <div className="flex gap-1 pb-1.5">
          {[1, 2, 3, 4, 5].map((i) => (
            <span key={i} className="h-2.5 w-6 rounded-sm" style={{ background: i <= rank ? accent : "#26263a" }} />
          ))}
        </div>
        <div className="ml-auto text-right">
          <div className="text-[10px] uppercase tracking-widest" style={{ color: "#8888aa" }}>
            Legend
          </div>
          <div className="text-2xl font-bold tabular-nums" style={{ color: "#f4f4f8" }}>
            {lp}
          </div>
        </div>
      </div>
      <div>
        <div className="h-1.5 w-full overflow-hidden rounded-full" style={{ background: "#26263a" }}>
          <div className="h-full rounded-full" style={{ width: pct + "%", background: accent }} />
        </div>
        <div className="mt-1 text-[11px]" style={{ color: "#6b6b8a" }}>
          {next ? `${Math.max(0, next - lp)} to next rank` : "Maxed — a true legend of the war"}
        </div>
      </div>

      {/* Attributes */}
      <div className="grid grid-cols-5 gap-2">
        {attrs.map(([label, v]) => (
          <div key={label} className="flex flex-col gap-1">
            <div className="text-[10px] uppercase tracking-wide" style={{ color: "#8888aa" }}>
              {label}
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full" style={{ background: "#26263a" }}>
              <div className="h-full" style={{ width: (v / attrMax) * 100 + "%", background: accent }} />
            </div>
            <div className="text-[10px] tabular-nums" style={{ color: "#a0a0c0" }}>
              {v}
            </div>
          </div>
        ))}
      </div>

      {/* Signature power */}
      {character.signature_name ? (
        <div className="rounded-md border p-3" style={{ borderColor: "#2a2a40" }}>
          <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: accent }}>
            Signature · {character.signature_name}
          </div>
          <p className="mt-1 text-sm leading-relaxed" style={{ color: "#d4d4e8" }}>
            {character.signature_effect}
          </p>
        </div>
      ) : null}

      {/* Ultimate */}
      {character.ultimate_name ? (
        <div className="rounded-md border p-3" style={{ borderColor: gold + "44", background: "#161428" }}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: gold }}>
              Ultimate · {character.ultimate_name}
            </div>
            <span
              className="rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
              style={{ background: ultReady ? gold : "#26263a", color: ultReady ? "#161428" : "#8888aa" }}
            >
              {ultStatus}
            </span>
          </div>
          <p className="mt-1 text-sm leading-relaxed" style={{ color: "#c9c9e0" }}>
            {character.ultimate_effect}
          </p>
        </div>
      ) : null}

      {/* Earned epithets */}
      {legend?.earned_epithets?.length ? (
        <div className="flex flex-wrap gap-2">
          {legend.earned_epithets.map((e, i) => (
            <span key={i} className="rounded-full px-3 py-1 text-xs italic" style={{ background: accent + "22", color: accent }}>
              &ldquo;{e}&rdquo;
            </span>
          ))}
        </div>
      ) : null}

      {!legend ? (
        <p className="text-[11px]" style={{ color: "#6b6b8a" }}>
          The war hasn&apos;t begun — your legend rises when Week 1 is scored.
        </p>
      ) : null}
    </section>
  );
}
