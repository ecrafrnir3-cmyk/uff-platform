import type { Metadata } from "next";
import "./globals.css";

// NOTE: Brand fonts (Bangers / Roboto Condensed) will be wired in via
// next/font/google once we're building on Vercel (this sandbox can't
// reach fonts.googleapis.com). System font stack for now.

export const metadata: Metadata = {
  title: "Ultimate Fantasy Football",
  description: "The Oracle's Calls — AI-powered weekly recaps for your fantasy league.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
