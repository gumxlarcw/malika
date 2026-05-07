import { Outfit } from 'next/font/google';
import type { Metadata, Viewport } from "next";
import './globals.css';
import "flatpickr/dist/flatpickr.css";
import { SidebarProvider } from '@/context/SidebarContext';
import { ThemeProvider } from '@/context/ThemeContext';
import PwaServiceWorkerRegister from "@/components/PwaServiceWorkerRegister";
import PwaInstallNudge from "@/components/PwaInstallNudge";
import PwaPushOnboardingModal from "@/components/PwaPushOnboardingModal";
import AppSplashScreen from "@/components/AppSplashScreen";
import ChunkLoadRecovery from "@/components/ChunkLoadRecovery";
import AnalyticsTracker from "@/components/AnalyticsTracker";
import PwaOfflineIndicator from "@/components/PwaOfflineIndicator";

const outfit = Outfit({
  subsets: ["latin"],
});

// Viewport configuration for native app-like experience
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#1f2937" },
  ],
};

export const metadata: Metadata = {
  title: {
    default: "MALIKA",
    template: "%s | MALIKA",
  },
  applicationName: "MALIKA",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/images/pwa/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/images/pwa/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [
      { url: "/images/pwa/icon-maskable-152.png", sizes: "152x152", type: "image/png" },
      { url: "/images/pwa/icon-maskable-167.png", sizes: "167x167", type: "image/png" },
      { url: "/images/pwa/icon-maskable-180.png", sizes: "180x180", type: "image/png" },
    ],
    shortcut: [{ url: "/images/pwa/icon-192.png", sizes: "192x192", type: "image/png" }],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <link rel="dns-prefetch" href="https://metabase.bpsmalut.com" />
        <link rel="preconnect" href="https://metabase.bpsmalut.com" crossOrigin="" />
      </head>
      <body className={`${outfit.className} dark:bg-gray-900`}>
        <ThemeProvider>
          <SidebarProvider>
            <PwaServiceWorkerRegister />
            <ChunkLoadRecovery />
            <AnalyticsTracker />
            <AppSplashScreen />
            <PwaInstallNudge />
            <PwaPushOnboardingModal />
            <PwaOfflineIndicator />
            {children}
          </SidebarProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
