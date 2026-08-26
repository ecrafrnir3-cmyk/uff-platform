export default function WarMeter({
  front,
  heroWins,
  villainWins,
  week,
}: {
  front: number;
  heroWins: number;
  villainWins: number;
  week: number | null;
}) {
  const clamp = Math.max(-10, Math.min(10, front));
  const pct = ((clamp + 10) / 20) * 100; // 50 = even, >50 = Vanguard ground
  const leader = front > 0 ? "The Vanguard holds the ground" : front < 0 ? "The Dominion holds the ground" : "The war hangs even";
  const leadColor = front > 0 ? "#0057FF" : front < 0 ? "#CC0000" : "#FFD700";

  return (
    <section className="flex flex-col gap-3 rounded-lg border p-5" style={{ borderColor: "#2a2a40", background: "#101024" }}>
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-wide" style={{ color: "#FFD700" }}>
          🗺 The Alliance War
        </h3>
        {week != null ? (
          <span className="text-xs" style={{ color: "#8888aa" }}>
            through Week {week}
          </span>
        ) : null}
      </div>

      <div className="flex items-center justify-between text-sm font-bold">
        <span style={{ color: "#0057FF" }}>⚔ Vanguard</span>
        <span style={{ color: "#CC0000" }}>Dominion 🐍</span>
      </div>
      <div className="relative h-3 w-full rounded-full" style={{ background: "linear-gradient(90deg,#0057FF33,#26263a,#CC000033)" }}>
        <div
          className="absolute top-1/2 h-6 w-1.5 -translate-y-1/2 rounded-full"
          style={{ left: `calc(${pct}% - 3px)`, background: leadColor, boxShadow: `0 0 8px ${leadColor}` }}
        />
      </div>

      <div className="flex items-center justify-between text-xs" style={{ color: "#a0a0c0" }}>
        <span className="tabular-nums">{heroWins} fronts won</span>
        <span className="font-semibold" style={{ color: leadColor }}>
          {leader}
        </span>
        <span className="tabular-nums">{villainWins} fronts won</span>
      </div>
    </section>
  );
}
