import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Pulse Sydney",
  description: "What's good tonight in Sydney.",
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
