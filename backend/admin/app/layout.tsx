import type { Metadata } from "next";
import Script from "next/script";
import "./globals.css";
import { AuthProvider } from "@/components/AuthProvider";
import AppShell from "@/components/AppShell";
import { ThemeProvider } from "@/components/ThemeProvider";
import ReactQueryProvider from "@/components/ReactQueryProvider";

export const metadata: Metadata = {
  title: "Admin Panel | MALIKA",
  description: "Backend administration panel for MALIKA - Maluku Utara Analytics & Insights for Knowledge Advancement",
  icons: {
    icon: "/backend/logo-mono.svg",
    shortcut: "/backend/logo-mono.svg",
    apple: "/backend/logo-mono.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <Script id="theme-init" strategy="beforeInteractive">
          {`(function(){
  try {
    var saved = localStorage.getItem('theme');
    var prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    var useDark = saved === 'dark' || (!saved && prefersDark);
    document.documentElement.classList.toggle('dark', !!useDark);
  } catch (e) {
    // ignore
  }
})();`}
        </Script>
      </head>
      <body className="antialiased bg-background text-foreground">
        <ReactQueryProvider>
          <ThemeProvider>
            <AuthProvider>
              <AppShell>{children}</AppShell>
            </AuthProvider>
          </ThemeProvider>
        </ReactQueryProvider>
      </body>
    </html>
  );
}
