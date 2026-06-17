export default function LeagueLoading() {
  return (
    <div className="min-h-screen px-6 py-12 sm:px-12" style={{ background: "#0d0d1a" }}>
      <div className="mx-auto max-w-3xl flex flex-col gap-6 animate-pulse">
        <div className="h-4 w-24 rounded" style={{ background: "#2a2a40" }} />
        <div className="h-4 w-40 rounded" style={{ background: "#2a2a40" }} />
        <div className="h-10 w-72 rounded" style={{ background: "#2a2a40" }} />
        <div className="h-28 rounded-lg" style={{ background: "#1c1c2b" }} />
        <div className="h-48 rounded-lg" style={{ background: "#1c1c2b" }} />
        <div className="flex flex-col gap-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 rounded-lg" style={{ background: "#1c1c2b" }} />
          ))}
        </div>
      </div>
    </div>
  );
}
