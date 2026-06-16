export default function DashboardLoading() {
  return (
    <div className="min-h-screen px-6 py-12 sm:px-12" style={{ background: "#0d0d1a" }}>
      <div className="mx-auto max-w-3xl flex flex-col gap-6 animate-pulse">
        <div className="h-4 w-32 rounded" style={{ background: "#2a2a40" }} />
        <div className="h-8 w-64 rounded" style={{ background: "#2a2a40" }} />
        <div className="flex flex-col gap-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-20 rounded-lg" style={{ background: "#1c1c2b" }} />
          ))}
        </div>
      </div>
    </div>
  );
}
