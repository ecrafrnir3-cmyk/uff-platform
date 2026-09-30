import type { ReactNode } from "react";

/**
 * A deliberately small markdown renderer for the comic issues.
 *
 * Why not react-markdown: this repo had no markdown dependency, the issues use a
 * tiny, known subset (H1-H3, ---, > captions, **bold**, *italic*, paragraphs),
 * and adding a dependency on a game week to render two files is a worse trade
 * than sixty lines. It also lets the script look like a comic script instead of
 * a README — PAGE/PANEL lines and captions get their own treatment.
 *
 * Everything returns React nodes; nothing uses dangerouslySetInnerHTML, so a
 * stray angle bracket in the prose can never become markup.
 */

const GOLD = "#FFD700";
const DIM = "#8888aa";
const BODY = "#d4d4e8";

/** **bold** and *italic*, applied to a single line. */
function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  // Split on bold first, then italic inside the non-bold runs.
  const boldParts = text.split(/(\*\*[^*]+\*\*)/g);
  boldParts.forEach((part, i) => {
    if (/^\*\*[^*]+\*\*$/.test(part)) {
      out.push(
        <strong key={`${keyBase}-b${i}`} style={{ color: "#f4f4f8" }}>
          {part.slice(2, -2)}
        </strong>,
      );
      return;
    }
    const italParts = part.split(/(\*[^*]+\*)/g);
    italParts.forEach((ip, j) => {
      if (/^\*[^*]+\*$/.test(ip)) {
        out.push(
          <em key={`${keyBase}-i${i}-${j}`} style={{ color: "#c9c9e0" }}>
            {ip.slice(1, -1)}
          </em>,
        );
      } else if (ip) {
        out.push(<span key={`${keyBase}-t${i}-${j}`}>{ip}</span>);
      }
    });
  });
  return out;
}

export default function ComicBody({ markdown }: { markdown: string }) {
  const blocks = markdown.split(/\n{2,}/);

  return (
    <div className="flex flex-col gap-4">
      {blocks.map((raw, i) => {
        const block = raw.trim();
        if (!block) return null;
        const key = `b${i}`;

        if (/^---+$/.test(block)) {
          return <hr key={key} style={{ borderColor: "#2a2a40" }} />;
        }
        if (/^###\s+/.test(block)) {
          return (
            <h3 key={key} className="text-sm font-semibold tracking-wide" style={{ color: DIM }}>
              {inline(block.replace(/^###\s+/, ""), key)}
            </h3>
          );
        }
        if (/^##\s+/.test(block)) {
          return (
            <h2 key={key} className="text-xl font-black tracking-wide" style={{ color: GOLD }}>
              {inline(block.replace(/^##\s+/, ""), key)}
            </h2>
          );
        }
        if (/^#\s+/.test(block)) {
          return (
            <h1 key={key} className="text-2xl font-black uppercase tracking-widest" style={{ color: GOLD }}>
              {inline(block.replace(/^#\s+/, ""), key)}
            </h1>
          );
        }
        // "> **CAPTION:** ..." — the boxed narration of a comic panel.
        if (/^>\s?/.test(block)) {
          const text = block.replace(/^>\s?/gm, "").trim();
          return (
            <blockquote
              key={key}
              className="rounded-md px-4 py-3 text-sm leading-relaxed"
              style={{
                background: "rgba(255,215,0,0.06)",
                borderLeft: `3px solid ${GOLD}`,
                color: "#e8e8f5",
              }}
            >
              {inline(text, key)}
            </blockquote>
          );
        }
        // "**PAGE ONE — SPLASH**" / "**Panel 2 — What Rust Expects**" — a whole
        // block that is nothing but bold is a stage direction, not prose.
        if (/^\*\*[^*]+\*\*$/.test(block)) {
          const label = block.slice(2, -2);
          const isPage = /^PAGE\b/i.test(label);
          return (
            <p
              key={key}
              className={isPage ? "text-xs font-black uppercase tracking-[0.2em]" : "text-xs font-bold uppercase tracking-widest"}
              style={{ color: isPage ? GOLD : DIM, marginTop: isPage ? "0.5rem" : 0 }}
            >
              {label}
            </p>
          );
        }
        return (
          <p key={key} className="text-sm leading-relaxed" style={{ color: BODY }}>
            {inline(block, key)}
          </p>
        );
      })}
    </div>
  );
}
