import type { Metadata } from "next";
import { Bangers, Roboto_Condensed } from "next/font/google";
import "./globals.css";

const bangers = Bangers({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
});

const robotoCondensed = Roboto_Condensed({
  weight: ["300", "400", "600", "700"],
  subsets: ["latin"],
  variable: "--font-body",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Ultimate Fantasy Football",
  description: "Hero vs. villain fantasy football leagues with superpowers. Pick your side.",
  themeColor: "#0d0d1a",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`h-full antialiased ${bangers.variable} ${robotoCondensed.variable}`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
