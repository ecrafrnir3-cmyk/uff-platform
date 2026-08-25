/**
 * Faction-themed silhouette placeholder shown until a real portrait (art_url)
 * exists — Higgsfield-generated art will drop into this slot later. Pure
 * presentational server component (no client hooks).
 */
type Props = {
  faction: "hero" | "villain";
  name?: string;
  className?: string;
};

export default function CharacterSilhouette({ faction, name, className }: Props) {
  const hero = faction === "hero";
  const glow = hero ? "#0057FF" : "#CC0000";
  const rim = hero ? "#FFD700" : "#7a0000";
  const gid = `glow-${faction}`;
  const rimId = `rim-${faction}`;

  return (
    <div
      className={className}
      style={{
        position: "relative",
        width: "100%",
        aspectRatio: "3 / 4",
        borderRadius: 14,
        overflow: "hidden",
        border: `1px solid ${hero ? "rgba(0,87,255,0.35)" : "rgba(204,0,0,0.35)"}`,
        background: "#0d0d1a",
      }}
    >
      <svg viewBox="0 0 300 400" width="100%" height="100%" preserveAspectRatio="xMidYMid slice" role="img" aria-label={name ? `${name} — portrait coming soon` : "Character portrait coming soon"}>
        <defs>
          <radialGradient id={gid} cx="50%" cy="38%" r="60%">
            <stop offset="0%" stopColor={glow} stopOpacity="0.55" />
            <stop offset="55%" stopColor={glow} stopOpacity="0.12" />
            <stop offset="100%" stopColor="#0d0d1a" stopOpacity="0" />
          </radialGradient>
          <linearGradient id={rimId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={rim} stopOpacity="0.9" />
            <stop offset="100%" stopColor={rim} stopOpacity="0.15" />
          </linearGradient>
        </defs>
        <rect x="0" y="0" width="300" height="400" fill="#0d0d1a" />
        <rect x="0" y="0" width="300" height="400" fill={`url(#${gid})`} />
        {/* bust silhouette: head + shoulders/cloak */}
        <g fill="#05050c">
          <path d="M150 300 C 90 300 55 340 48 400 L 252 400 C 245 340 210 300 150 300 Z" />
          <circle cx="150" cy="188" r="62" />
          <path d="M150 250 C 120 250 96 268 92 300 L 208 300 C 204 268 180 250 150 250 Z" />
        </g>
        {/* faction rim light along the shoulders */}
        <path d="M48 400 C 55 340 90 300 150 300 C 210 300 245 340 252 400" fill="none" stroke={`url(#${rimId})`} strokeWidth="2.5" opacity="0.7" />
        <circle cx="150" cy="188" r="62" fill="none" stroke={rim} strokeWidth="1.5" opacity="0.35" />
      </svg>
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 10,
          textAlign: "center",
          fontSize: 10,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          color: hero ? "#7f9cff" : "#e08a8a",
        }}
      >
        Portrait incoming
      </div>
    </div>
  );
}
