"use client";

export default function PlayerPhoto({
  playerId,
  size = 28,
  position,
}: {
  playerId: string;
  size?: number;
  position?: string | null;
}) {
  // DEF/DST players use team abbreviations as IDs — no individual headshot available
  if (position === "DEF" || position === "DST") {
    return (
      <div
        style={{
          width: size, height: size, borderRadius: "50%", flexShrink: 0,
          background: "rgba(204,0,0,0.2)", display: "flex",
          alignItems: "center", justifyContent: "center",
          fontSize: size * 0.3, fontWeight: 700, color: "#CC0000",
        }}
      >
        D
      </div>
    );
  }

  return (
    <img
      src={`https://sleepercdn.com/content/nfl/players/thumb/${playerId}.jpg`}
      alt=""
      width={size}
      height={size}
      onError={(e) => {
        (e.currentTarget as HTMLImageElement).style.visibility = "hidden";
      }}
      style={{
        borderRadius: "50%", objectFit: "cover",
        flexShrink: 0, width: size, height: size,
        background: "#1c1c2b",
      }}
    />
  );
}
