import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { RegisterServiceWorker } from "./register-service-worker";
import "./globals.css";

// display: "swap" + a system-font fallback stack means first paint never
// waits on the webfont download — text renders immediately in the
// fallback and swaps in once Inter loads.
const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-sans",
  fallback: ["system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"],
});

export const metadata: Metadata = {
  title: "Pulse Sydney",
  description: "What's good tonight in Sydney.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Pulse",
  },
  icons: {
    icon: [{ url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
    apple: [{ url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0b0d10",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="min-h-dvh bg-ink-950 font-sans text-ink-50">
        {children}
        <RegisterServiceWorker />
        <SpeedInsights />
      </body>
    </html>
  );
}
