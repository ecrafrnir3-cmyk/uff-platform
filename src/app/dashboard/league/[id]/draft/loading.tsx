export default function DraftLoading() {
  return (
    <div className="min-h-screen animate-pulse px-4 py-8 sm:px-8" style={{ background: "#0d0d1a" }}>
      <div className="mx-auto max-w-5xl flex flex-col gap-6">
        <div className="h-4 w-32 rounded" style={{ background: "#2a2a40" }} />
        <div className="h-5 w-24 rounded" style={{ background: "#1c1c2b" }} />
        <div className="h-10 w-56 rounded" style={{ background: "#2a2a40" }} />
        <div className="h-4 w-48 rounded" style={{ background: "#1c1c2b" }} />
        <div className="h-16 rounded-lg" style={{ background: "#1c1c2b" }} />
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="flex flex-col gap-3">
            <div className="h-6 w-40 rounded" style={{ background: "#2a2a40" }} />
            <div className="h-10 rounded-md" style={{ background: "#1c1c2b" }} />
            <div className="flex gap-1">
              {Array.from({ length: 7 }).map((_, i) => (
                <div key={i} className="h-8 w-12 rounded" style={{ background: "#1c1c2b" }} />
              ))}
            </div>
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-12 rounded-lg" style={{ background: "#1c1c2b" }} />
            ))}
          </div>
          <div className="flex flex-col gap-3">
            <div className="h-6 w-32 rounded" style={{ background: "#2a2a40" }} />
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-16 rounded-lg" style={{ background: "#1c1c2b" }} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
