import "./globals.css";
import { AuthProvider } from "../components/AuthProvider";
import PWARegister from "../components/PWARegister";
import PWAEntryGuard from "../components/PWAEntryGuard";
import { Orbitron } from "next/font/google";
import type { Viewport } from "next";

const displayFont = Orbitron({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-display",
});

export const metadata = {
  title: "PL Predictions",
  applicationName: "PL Predictions",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "PL Predictions",
  },
  icons: {
    icon: "/icons/icon-192.png",
    apple: "/icons/apple-touch-icon.png",
  },
  formatDetection: {
    telephone: false,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#0ea5a4",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={`min-h-[100dvh] ${displayFont.variable}`}>
        <AuthProvider>
          <PWARegister />
          <PWAEntryGuard />
          {children}
        </AuthProvider>
      </body>
    </html>
  );
}
