import "./globals.css";
import { AuthProvider } from "../components/AuthProvider";
import PWARegister from "../components/PWARegister";

export const metadata = {
  title: "PL Predictions",
  applicationName: "PL Predictions",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "PL Predictions",
  },
  icons: {
    icon: "/icons/icon-192.png",
    apple: "/icons/apple-touch-icon.png",
  },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-[100dvh]">
        <AuthProvider>
          <PWARegister />
          {children}
        </AuthProvider>
      </body>
    </html>
  );
}
