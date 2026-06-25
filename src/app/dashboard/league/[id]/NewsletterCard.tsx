"use client";

import { useState } from "react";

export default function NewsletterCard({
  week,
  content,
  generatedAt,
}: {
  week: number;
  content: string;
  generatedAt: string;
}) {
  const [expanded, setExpanded] = useState(false);

  const dateStr = new Date(generatedAt).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });

  // Show first ~280 chars as preview when collapsed
  const preview = content.slice(0, 280).trimEnd();
  const isTruncated = content.length > 280;

  return (
    <div
      className="flex flex-col gap-3 rounded-xl border p-5"
      style={{ borderColor: "#FFD70033", background: "rgba(255,215,0,0.03)" }}
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-base">📰</span>
          <div>
            <p className="text-sm font-bold" style={{ color: "#FFD700" }}>
              Week {week} — League Newsletter
            </p>
            <p className="text-xs" style={{ color: "#f4f4f8" }}>
              Oracle Dispatch · {dateStr}
            </p>
          </div>
        </div>
        {isTruncated && (
          <button
            onClick={() => setExpanded((e) => !e)}
            className="shrink-0 rounded-full px-3 py-1 text-xs font-semibold transition hover:opacity-80"
            style={{
              background: "rgba(255,215,0,0.1)",
              color: "#FFD700",
              border: "1px solid #FFD70033",
            }}
          >
            {expanded ? "Collapse ↑" : "Read ↓"}
          </button>
        )}
      </div>

      {/* Content */}
      <div
        className="text-sm leading-relaxed"
        style={{ color: "#d4d4e8" }}
      >
        {expanded || !isTruncated ? (
          // Full content — split on double newline for paragraph breaks
          content.split(/\n\n+/).map((para, i) => (
            <p key={i} className={i > 0 ? "mt-3" : ""}>
              {para.trim()}
            </p>
          ))
        ) : (
          <>
            <p>{preview}{isTruncated ? "…" : ""}</p>
            <button
              onClick={() => setExpanded(true)}
              className="mt-1 text-xs underline"
              style={{ color: "#FFD700" }}
            >
              Read full newsletter
            </button>
          </>
        )}
      </div>
    </div>
  );
}
