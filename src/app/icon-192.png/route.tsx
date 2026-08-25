import { ImageResponse } from "next/og";

// 192×192 PWA icon — same mark as /icon, scaled. Referenced by manifest.ts.
export const dynamic = "force-static";

export function GET() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "#0d0d1a",
        }}
      >
        <div
          style={{
            fontSize: 68,
            fontWeight: 900,
            color: "#FFD700",
            letterSpacing: 4,
            fontFamily: "sans-serif",
          }}
        >
          UFF
        </div>
        <div
          style={{
            marginTop: 10,
            width: 82,
            height: 7,
            background: "#0057FF",
            borderRadius: 4,
          }}
        />
      </div>
    ),
    { width: 192, height: 192 }
  );
}
