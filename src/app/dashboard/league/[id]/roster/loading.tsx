export default function RosterLoading() {
  return (
    <div className="min-h-screen px-6 py-12 sm:px-12" style={{ background: "#0d0d1a" }}>
      <div className="mx-auto max-w-6xl flex flex-col gap-6 animate-pulse">
        <div className="h-4 w-24 rounded" style={{ background: "#2a2a40" }} />
        <div className="h-4 w-24 rounded" style={{ background: "#2a2a40" }} />
        <div className="h-10 w-56 rounded" style={{ background: "#2a2a40" }} />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-32 rounded-lg" style={{ background: "#1c1c2b" }} />
          ))}
        </div>
        <div className="flex flex-col gap-2">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-14 rounded-lg" style={{ background: "#1c1c2b" }} />
          ))}
        </div>
      </div>
    </div>
  );
}
