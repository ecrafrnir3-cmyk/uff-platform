import { ImageResponse } from "next/og";

export const size = { width: 512, height: 512 };
export const contentType = "image/png";

export default function Icon() {
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
            fontSize: 180,
            fontWeight: 900,
            color: "#FFD700",
            letterSpacing: 12,
            fontFamily: "sans-serif",
          }}
        >
          UFF
        </div>
        <div
          style={{
            marginTop: 28,
            width: 220,
            height: 18,
            background: "#0057FF",
            borderRadius: 9,
          }}
        />
      </div>
    ),
    { ...size }
  );
}
