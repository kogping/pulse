import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Pulse Sydney — Console",
  description: "Curator console for Pulse Sydney.",
};

// The verification queue (app/queue) is used one-thumb on a phone outdoors —
// this must not scale down to desktop-page-in-miniature.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover", // lets safe-area-inset-* (packages/config/tailwind-preset.js) resolve on notched phones
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
