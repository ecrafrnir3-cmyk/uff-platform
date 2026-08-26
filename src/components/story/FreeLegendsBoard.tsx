import { rankName, type Faction } from "@/lib/story-engine/rules";

export interface FreeLegend {
  character_id: number;
  name: string;
  epithet: string;
  faction: Faction;
  rank: number;
  legend_points: number;
}

export default function FreeLegendsBoard({ legends }: { legends: FreeLegend[] }) {
  const heroes = legends.filter((l) => l.faction === "hero");
  const villains = legends.filter((l) => l.faction === "villain");

  const Col = ({ title, list, accent }: { title: string; list: FreeLegend[]; accent: string }) => (
    <div className="flex flex-col gap-2">
      <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: accent }}>
        {title}
      </div>
      {list.length === 0 ? (
        <p className="text-[11px]" style={{ color: "#6b6b8a" }}>
          None — the order is fully claimed.
        </p>
      ) : (
        list.map((l) => (
          <div key={l.character_id} className="flex items-center justify-between rounded-md border px-3 py-2" style={{ borderColor: "#2a2a40" }}>
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold" style={{ color: "#f4f4f8" }}>
                {l.name}
              </div>
              <div className="truncate text-[11px] italic" style={{ color: accent }}>
                {l.epithet}
              </div>
            </div>
            <div className="ml-3 shrink-0 text-right">
              <div className="text-[11px] uppercase tracking-wide" style={{ color: "#a0a0c0" }}>
                {rankName(l.rank, l.faction)}
              </div>
              <div className="text-[11px] tabular-nums" style={{ color: "#6b6b8a" }}>
                {l.legend_points} LP
              </div>
            </div>
          </div>
        ))
      )}
    </div>
  );

  return (
    <section className="flex flex-col gap-3 rounded-lg border p-5" style={{ borderColor: "#2a2a40", background: "#101024" }}>
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-wide" style={{ color: "#FFD700" }}>
          🎖 The Free Legends
        </h3>
        <span className="text-[11px]" style={{ color: "#8888aa" }}>
          unclaimed, roaming the war
        </span>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Col title="⚔ Vanguard" list={heroes} accent="#0057FF" />
        <Col title="Dominion 🐍" list={villains} accent="#CC0000" />
      </div>
    </section>
  );
}
