import { ImageResponse } from "next/og";

// 512×512 MASKABLE PWA icon — the mark is shrunk into the central 80% safe
// zone so Android's adaptive-icon shapes (circle, squircle) don't clip it.
// Referenced by manifest.ts.
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
            fontSize: 130,
            fontWeight: 900,
            color: "#FFD700",
            letterSpacing: 8,
            fontFamily: "sans-serif",
          }}
        >
          UFF
        </div>
        <div
          style={{
            marginTop: 20,
            width: 160,
            height: 13,
            background: "#0057FF",
            borderRadius: 7,
          }}
        />
      </div>
    ),
    { width: 512, height: 512 }
  );
}
