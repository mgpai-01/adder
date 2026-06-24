import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AuthProvider } from "@/lib/auth";

export const metadata: Metadata = {
  applicationName: "MGP Repair",
  title: "MGP Pallet Repair Tracking",
  description: "Mobile production entry and payroll tracking for MGP pallet repair operations.",
  manifest: "/manifest.json",
  formatDetection: { telephone: false },
  appleWebApp: {
    capable: true,
    title: "MGP Repair",
    statusBarStyle: "black-translucent"
  },
  icons: {
    icon: [
      { url: "/icons/favicon-48.png", sizes: "48x48", type: "image/png" },
      { url: "/icons/icon.svg", type: "image/svg+xml" }
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }]
  }
};

export const viewport: Viewport = {
  themeColor: "#18222c",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  return (
    <html lang="en">
      {supabaseUrl && (
        <head>
          {/* Warm DNS + TLS to Supabase before any JS runs so the first
              sign-in request is as fast as possible. */}
          <link rel="preconnect" href={supabaseUrl} crossOrigin="anonymous" />
          <link rel="dns-prefetch" href={supabaseUrl} />
        </head>
      )}
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
