import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MGP Pallet Repair Tracking",
  description: "Mobile production entry and payroll tracking for MGP pallet repair operations.",
  manifest: "/manifest.json"
};

export const viewport: Viewport = {
  themeColor: "#18222c",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
