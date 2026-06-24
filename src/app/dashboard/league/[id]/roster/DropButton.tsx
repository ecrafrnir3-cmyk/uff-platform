"use client";

import { useRef } from "react";
import { dropPlayer } from "../player-actions";

export default function DropButton({
  leagueId,
  playerId,
  playerName,
  returnTo = "roster",
}: {
  leagueId: string;
  playerId: string;
  playerName: string;
  returnTo?: string;
}) {
  const formRef = useRef<HTMLFormElement>(null);

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
