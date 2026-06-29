"use client";

import { useRef, useTransition } from "react";
import { setTokenChoice } from "../actions";
import { TOKEN_NAMES } from "@/lib/token-names";

const POSITIONS = ["QB", "RB", "WR", "TE", "K", "DEF"];

/**
 * Displayed inside WeeklyTokenCard for tokens that require a manager choice:
 *   - Token 7 (Position Power): choose a position
 *   - Token 18 (Second Wind):   choose a past used token
 *
 * Submits via server action setTokenChoice.
 */
export default function TokenChoicePicker({
  leagueId,
  week,
  tokenId,
  currentChoice,
  pastUsedTokenIds,
  locked,
}: {
  leagueId: string;
  week: number;
  tokenId: number;
  currentChoice: string | null;
  /** For Second Wind: list of token_ids the manager has already used */
  pastUsedTokenIds: number[];
  /** True once lineup is locked — no more changes */
  locked: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  if (locked) {
    // After lock, just show what was chosen (or "not set")
    if (!currentChoice) {
      return (
        <p className="mt-2 text-xs" style={{ color: "#CC0000" }}>
          ⚠ No choice made — this token will have no effect.
        </p>
      );
    }
    return null; // WeeklyTokenCard already shows the choice in the title row
  }

  function handleChange() {
    if (formRef.current) {
      startTransition(() => {
        const data = new FormData(formRef.current!);
        setTokenChoice(data);
      });
    }
  }

  if (tokenId === 7) {
    // Position Power: pick a position
    return (
      <form ref={formRef} action={setTokenChoice} className="mt-2 flex items-center gap-2">
        <input type="hidden" name="leagueId" value={leagueId} />
        <input type="hidden" name="week"     value={week} />
        <label className="text-xs" style={{ color: "#f4f4f8" }}>
          Choose position:
        </label>
        <select
          name="choice"
          defaultValue={currentChoice ?? ""}
          onChange={handleChange}
          className="rounded border px-2 py-1 text-xs font-semibold"
          style={{ background: "#1c1c2b", borderColor: "#2a2a40", color: "#f4f4f8" }}
        >
          <option value="" disabled>Select…</option>
          {POSITIONS.map((pos) => (
            <option key={pos} value={pos}>{pos}</option>
          ))}
        </select>
        {isPending && <span className="text-xs" style={{ color: "#f4f4f8" }}>Saving…</span>}
      </form>
    );
  }

  if (tokenId === 18) {
    // Second Wind: pick a past used token to replay
    if (pastUsedTokenIds.length === 0) {
      return (
        <p className="mt-2 text-xs" style={{ color: "#f4f4f8" }}>
          No prior tokens to replay yet — use Second Wind in a later week.
        </p>
      );
    }
    return (
      <form ref={formRef} action={setTokenChoice} className="mt-2 flex items-center gap-2">
        <input type="hidden" name="leagueId" value={leagueId} />
        <input type="hidden" name="week"     value={week} />
        <label className="text-xs" style={{ color: "#f4f4f8" }}>
          Replay token:
        </label>
        <select
          name="choice"
          defaultValue={currentChoice ?? ""}
          onChange={handleChange}
          className="rounded border px-2 py-1 text-xs font-semibold"
          style={{ background: "#1c1c2b", borderColor: "#2a2a40", color: "#f4f4f8" }}
        >
          <option value="" disabled>Select…</option>
          {pastUsedTokenIds.map((tid) => (
            <option key={tid} value={String(tid)}>
              {TOKEN_NAMES[tid] ?? `Token ${tid}`}
            </option>
          ))}
        </select>
        {isPending && <span className="text-xs" style={{ color: "#f4f4f8" }}>Saving…</span>}
      </form>
    );
  }

  return null;
}
