"use client";

import { useRef, useState, useTransition } from "react";
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
    // Second Wind: pick a past used token to replay. Replaying a token that
    // itself needs a choice (Position Power, #7) asks for that sub-choice too —
    // stored as "7:POS" so the scoring engine can apply it (was a silent no-op).
    if (pastUsedTokenIds.length === 0) {
      return (
        <p className="mt-2 text-xs" style={{ color: "#f4f4f8" }}>
          No prior tokens to replay yet — use Second Wind in a later week.
        </p>
      );
    }
    return (
      <SecondWindPicker
        leagueId={leagueId}
        week={week}
        currentChoice={currentChoice}
        pastUsedTokenIds={pastUsedTokenIds}
        isPending={isPending}
        startTransition={startTransition}
      />
    );
  }

  return null;
}

function SecondWindPicker({
  leagueId,
  week,
  currentChoice,
  pastUsedTokenIds,
  isPending,
  startTransition,
}: {
  leagueId: string;
  week: number;
  currentChoice: string | null;
  pastUsedTokenIds: number[];
  isPending: boolean;
  startTransition: (cb: () => void) => void;
}) {
  const [savedPast, savedPos] = (currentChoice ?? "").split(":");
  const [pastToken, setPastToken] = useState<string>(savedPast ?? "");
  const [position, setPosition] = useState<string>(savedPos ?? "");

  function submitChoice(past: string, pos: string) {
    // Position Power replay is incomplete until the position is picked
    if (!past) return;
    if (past === "7" && !pos) return;
    const choice = past === "7" ? `7:${pos}` : past;
    const data = new FormData();
    data.set("leagueId", leagueId);
    data.set("week", String(week));
    data.set("choice", choice);
    startTransition(() => {
      setTokenChoice(data);
    });
  }

  return (
    <div className="mt-2 flex items-center gap-2 flex-wrap">
      <label className="text-xs" style={{ color: "#f4f4f8" }}>
        Replay token:
      </label>
      <select
        value={pastToken}
        onChange={(e) => {
          setPastToken(e.target.value);
          submitChoice(e.target.value, position);
        }}
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
      {pastToken === "7" && (
        <>
          <label className="text-xs" style={{ color: "#f4f4f8" }}>
            Position:
          </label>
          <select
            value={position}
            onChange={(e) => {
              setPosition(e.target.value);
              submitChoice(pastToken, e.target.value);
            }}
            className="rounded border px-2 py-1 text-xs font-semibold"
            style={{ background: "#1c1c2b", borderColor: "#2a2a40", color: "#f4f4f8" }}
          >
            <option value="" disabled>Select…</option>
            {POSITIONS.map((pos) => (
              <option key={pos} value={pos}>{pos}</option>
            ))}
          </select>
        </>
      )}
      {isPending && <span className="text-xs" style={{ color: "#f4f4f8" }}>Saving…</span>}
    </div>
  );
}
