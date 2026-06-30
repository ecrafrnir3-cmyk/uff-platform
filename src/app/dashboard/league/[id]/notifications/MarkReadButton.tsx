"use client";

import { useTransition } from "react";
import { markAllRead } from "./actions";

export default function MarkReadButton({ leagueId }: { leagueId: string }) {
  const [pending, startTransition] = useTransition();

  return (
    <button
      disabled={pending}
      onClick={() => startTransition(() => markAllRead(leagueId))}
      className="rounded px-3 py-1.5 text-xs font-semibold transition-opacity hover:opacity-80 disabled:opacity-50"
      style={{ background: "rgba(0,87,255,0.15)", color: "#0057FF", border: "1px solid rgba(0,87,255,0.3)" }}
    >
      {pending ? "Marking…" : "Mark all read"}
    </button>
  );
}
