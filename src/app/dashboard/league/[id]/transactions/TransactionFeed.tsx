"use client";

import { useState } from "react";

const POS_COLOR: Record<string, string> = {
  QB: "#0057FF", RB: "#3DDC84", WR: "#FFD700",
  TE: "#FF6B35", K: "#f4f4f8", DEF: "#CC0000", DST: "#CC0000",
};

function PosBadge({ pos }: { pos: string | null }) {
  const p = (pos ?? "?").toUpperCase();
  const color = POS_COLOR[p] ?? "#aaaacc";
  return (
    <span
      className="inline-block rounded px-1.5 py-0.5 text-xs font-bold uppercase leading-none"
      style={{ background: color + "22", color }}
    >
      {p}
    </span>
  );
}

function factionColor(faction: string | null) {
  if (faction === "hero") return "#0057FF";
  if (faction === "villain") return "#CC0000";
  return "#f4f4f8";
}

function timeAgo(date: Date): string {
  const diff = Date.now() - date.getTime();
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (mins < 2) return "just now";
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export interface PlayerInfo {
  playerId: string;
  playerName: string;
  position: string | null;
  team: string | null;
}

export type Transaction =
  | {
      type: "draft";
      id: string;
      timestamp: Date;
      teamName: string;
      faction: string | null;
      player: PlayerInfo;
      round: number;
      pickNo: number;
    }
  | {
      type: "add";
      id: string;
      timestamp: Date;
      teamName: string;
      faction: string | null;
      player: PlayerInfo;
    }
  | {
      type: "drop";
      id: string;
      timestamp: Date;
      teamName: string;
      faction: string | null;
      player: PlayerInfo;
    }
  | {
      type: "trade";
      id: string;
      timestamp: Date;
      proposerName: string;
      proposerFaction: string | null;
      receiverName: string;
      receiverFaction: string | null;
      proposerSent: PlayerInfo[];
      receiverSent: PlayerInfo[];
    };

type Filter = "all" | "waiver" | "trade" | "draft";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all",    label: "All" },
  { key: "waiver", label: "Adds & Drops" },
  { key: "trade",  label: "Trades" },
  { key: "draft",  label: "Draft" },
];

function TxRow({ tx }: { tx: Transaction }) {
  if (tx.type === "draft") {
    return (
      <div
        className="flex items-start gap-3 rounded-lg border px-4 py-3"
        style={{ borderColor: "#2a2a40", background: "#0d0d1a" }}
      >
        {/* Icon */}
        <span className="mt-0.5 shrink-0 text-base">🏈</span>
        {/* Body */}
        <div className="min-w-0 flex-1">
          <p className="text-sm leading-snug">
            <span className="font-semibold" style={{ color: factionColor(tx.faction) }}>
              {tx.teamName}
            </span>
            <span className="text-white"> drafted </span>
            <span className="font-semibold text-white">{tx.player.playerName}</span>
            {" "}
            <PosBadge pos={tx.player.position} />
            {tx.player.team && (
              <span className="ml-1 text-xs" style={{ color: "#8888aa" }}>{tx.player.team}</span>
            )}
          </p>
          <p className="mt-0.5 text-xs" style={{ color: "#6666888" }}>
            Round {tx.round}, Pick #{tx.pickNo}
          </p>
        </div>
        {/* Timestamp */}
        <span className="shrink-0 text-xs" style={{ color: "#6b6b8a" }}>
          {timeAgo(tx.timestamp)}
        </span>
      </div>
    );
  }

  if (tx.type === "add") {
    return (
      <div
        className="flex items-start gap-3 rounded-lg border px-4 py-3"
        style={{ borderColor: "#2a2a40", background: "#0d0d1a" }}
      >
        <span className="mt-0.5 shrink-0 text-base">➕</span>
        <div className="min-w-0 flex-1">
          <p className="text-sm leading-snug">
            <span className="font-semibold" style={{ color: factionColor(tx.faction) }}>
              {tx.teamName}
            </span>
            <span className="text-white"> added </span>
            <span className="font-semibold text-white">{tx.player.playerName}</span>
            {" "}
            <PosBadge pos={tx.player.position} />
            {tx.player.team && (
              <span className="ml-1 text-xs" style={{ color: "#8888aa" }}>{tx.player.team}</span>
            )}
          </p>
        </div>
        <span className="shrink-0 text-xs" style={{ color: "#6b6b8a" }}>
          {timeAgo(tx.timestamp)}
        </span>
      </div>
    );
  }

  if (tx.type === "drop") {
    return (
      <div
        className="flex items-start gap-3 rounded-lg border px-4 py-3"
        style={{ borderColor: "#2a2a40", background: "#0d0d1a" }}
      >
        <span className="mt-0.5 shrink-0 text-base">➖</span>
        <div className="min-w-0 flex-1">
          <p className="text-sm leading-snug">
            <span className="font-semibold" style={{ color: factionColor(tx.faction) }}>
              {tx.teamName}
            </span>
            <span className="text-white"> dropped </span>
            <span className="font-semibold" style={{ color: "#aaaacc" }}>{tx.player.playerName}</span>
            {" "}
            <PosBadge pos={tx.player.position} />
            {tx.player.team && (
              <span className="ml-1 text-xs" style={{ color: "#8888aa" }}>{tx.player.team}</span>
            )}
          </p>
        </div>
        <span className="shrink-0 text-xs" style={{ color: "#6b6b8a" }}>
          {timeAgo(tx.timestamp)}
        </span>
      </div>
    );
  }

  // trade
  return (
    <div
      className="flex flex-col gap-2 rounded-lg border px-4 py-3"
      style={{ borderColor: "#FFD70033", background: "rgba(255,215,0,0.02)" }}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: "#FFD700" }}>
          🔄 Trade Completed
        </p>
        <span className="text-xs" style={{ color: "#6b6b8a" }}>
          {timeAgo(tx.timestamp)}
        </span>
      </div>
      <div className="flex flex-col gap-1.5 sm:flex-row sm:gap-4">
        {/* Proposer side */}
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold mb-1" style={{ color: factionColor(tx.proposerFaction) }}>
            {tx.proposerName} sent
          </p>
          <div className="flex flex-col gap-0.5">
            {tx.proposerSent.map((p) => (
              <p key={p.playerId} className="text-sm text-white">
                {p.playerName} <PosBadge pos={p.position} />
                {p.team && <span className="ml-1 text-xs" style={{ color: "#8888aa" }}>{p.team}</span>}
              </p>
            ))}
          </div>
        </div>
        <div className="hidden sm:flex items-center text-lg" style={{ color: "#6b6b8a" }}>⇄</div>
        {/* Receiver side */}
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold mb-1" style={{ color: factionColor(tx.receiverFaction) }}>
            {tx.receiverName} sent
          </p>
          <div className="flex flex-col gap-0.5">
            {tx.receiverSent.map((p) => (
              <p key={p.playerId} className="text-sm text-white">
                {p.playerName} <PosBadge pos={p.position} />
                {p.team && <span className="ml-1 text-xs" style={{ color: "#8888aa" }}>{p.team}</span>}
              </p>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function TransactionFeed({ transactions }: { transactions: Transaction[] }) {
  const [filter, setFilter] = useState<Filter>("all");

  const filtered = transactions.filter((tx) => {
    if (filter === "all") return true;
    if (filter === "waiver") return tx.type === "add" || tx.type === "drop";
    if (filter === "trade") return tx.type === "trade";
    if (filter === "draft") return tx.type === "draft";
    return true;
  });

  return (
    <div className="flex flex-col gap-4">
      {/* Filter pills */}
      <div className="flex flex-wrap gap-1.5">
        {FILTERS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className="rounded-full px-4 py-1.5 text-xs font-semibold transition"
            style={{
              background: filter === key ? "#0057FF" : "#1c1c2b",
              color: "#f4f4f8",
              border: filter === key ? "1px solid #0057FF" : "1px solid #2a2a40",
            }}
          >
            {label}
          </button>
        ))}
        <span className="ml-auto self-center text-xs" style={{ color: "#6b6b8a" }}>
          {filtered.length} transaction{filtered.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Feed */}
      {filtered.length === 0 ? (
        <div
          className="rounded-lg border p-8 text-center text-sm"
          style={{ borderColor: "#2a2a40", color: "#6b6b8a" }}
        >
          No {filter === "all" ? "" : filter + " "}transactions yet.
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {filtered.map((tx) => (
            <TxRow key={`${tx.type}-${tx.id}`} tx={tx} />
          ))}
        </div>
      )}
    </div>
  );
}
