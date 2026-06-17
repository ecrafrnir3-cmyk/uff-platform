import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
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
            fontSize: 62,
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
            width: 76,
            height: 7,
            background: "#0057FF",
            borderRadius: 4,
          }}
        />
      </div>
    ),
    { ...size }
  );
}
