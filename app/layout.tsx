import "./globals.css";
import { AuthProvider } from "../components/AuthProvider";

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="text-foreground">
        <div className="min-h-screen bg-app">
          <AuthProvider>{children}</AuthProvider>
        </div>
      </body>
    </html>
  );
}
