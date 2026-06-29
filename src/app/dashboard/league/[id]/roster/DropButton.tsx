"use client";

import { useRef } from "react";
import { dropPlayer } from "../player-actions";

export default function DropButton({
  leagueId,
  playerId,
  playerName,
  returnTo = "roster",
  cantCut = false,
}: {
  leagueId: string;
  playerId: string;
  playerName: string;
  returnTo?: string;
  cantCut?: boolean;
}) {
  const formRef = useRef<HTMLFormElement>(null);

  if (cantCut) {
    return (
      <span
        className="rounded px-2 py-0.5 text-xs font-semibold"
        title="This player is on the Can't Cut List"
        style={{ background: "rgba(204,0,0,0.12)", color: "#CC0000", border: "1px solid #CC000033" }}
      >
        Protected
      </span>
    );
  }

  return (
    <form ref={formRef} action={dropPlayer}>
      <input type="hidden" name="leagueId" value={leagueId} />
      <input type="hidden" name="playerId" value={playerId} />
      <input type="hidden" name="returnTo" value={returnTo} />
      <button
        type="button"
        className="rounded px-2 py-0.5 text-xs font-semibold"
        style={{ background: "#1c1c2b", color: "#f4f4f8" }}
        onClick={() => {
          if (window.confirm(`Drop ${playerName}? This cannot be undone.`)) {
            formRef.current?.requestSubmit();
          }
        }}
      >
        Drop
      </button>
    </form>
  );
}
