export interface BattleLine {
  week: number;
  kind: "war" | "internal" | "interloper" | "first_clash" | "siege" | "last_front";
  winner: "hero" | "villain" | "draw" | null;
  winnerName: string | null;
  narration: string;
}

const KIND_LABEL: Record<BattleLine["kind"], string> = {
  war: "War Battle",
  internal: "Internal Duel",
  interloper: "Interloper",
  first_clash: "The First Clash",
  siege: "The Siege",
  last_front: "The Last Front",
};

export default function BattleReport({ battles }: { battles: BattleLine[] }) {
  return (
    <section className="flex flex-col gap-3 rounded-lg border p-5" style={{ borderColor: "#2a2a40", background: "#101024" }}>
      <h3 className="text-sm font-semibold uppercase tracking-wide" style={{ color: "#FFD700" }}>
        📜 Battle Report
      </h3>
      {battles.length === 0 ? (
        <p className="text-[11px]" style={{ color: "#6b6b8a" }}>
          No battles yet — the first front opens when Week 1 is scored.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {battles.map((b, i) => {
            const accent = b.winner === "hero" ? "#0057FF" : b.winner === "villain" ? "#CC0000" : "#8888aa";
            const setpiece = b.kind === "first_clash" || b.kind === "siege" || b.kind === "last_front";
            return (
              <div
                key={i}
                className="flex flex-col gap-1 rounded-md border p-3"
                style={{ borderColor: setpiece ? accent + "66" : "#2a2a40", background: setpiece ? accent + "11" : "transparent" }}
              >
                <div className="flex items-center justify-between">
                  <span
                    className="rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
                    style={{ background: accent + "22", color: accent }}
                  >
                    {KIND_LABEL[b.kind]}
                  </span>
                  <span className="text-[10px] uppercase tracking-widest" style={{ color: "#8888aa" }}>
                    Week {b.week}
                  </span>
                </div>
                <p className="text-sm leading-snug" style={{ color: "#d4d4e8" }}>
                  {b.narration}
                </p>
                {b.winnerName ? (
                  <p className="text-[11px]" style={{ color: accent }}>
                    ★ {b.winnerName}
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
