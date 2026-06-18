export default function Loading() {
  return (
    <div className="min-h-screen px-6 py-12 sm:px-12" style={{ background: "#0d0d1a" }}>
      <div className="mx-auto max-w-4xl flex flex-col gap-6 animate-pulse">
        <div className="h-4 w-24 rounded" style={{ background: "#2a2a40" }} />
        <div className="h-8 w-48 rounded" style={{ background: "#2a2a40" }} />
        <div className="flex flex-col gap-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-16 rounded-lg" style={{ background: "#1c1c2b" }} />
          ))}
        </div>
      </div>
    </div>
  );
}
