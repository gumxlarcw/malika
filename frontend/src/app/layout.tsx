import { Outfit, Instrument_Serif, IBM_Plex_Sans, IBM_Plex_Mono } from 'next/font/google';
import type { Metadata, Viewport } from "next";
import './globals.css';
import "flatpickr/dist/flatpickr.css";
import { SidebarProvider } from '@/context/SidebarContext';
import { ThemeProvider } from '@/context/ThemeContext';
import { ChatModalProvider } from '@/context/ChatModalContext';
import ChatModal from '@/components/chat/ChatModal';
import ChatLinkInterceptor from '@/components/chat/ChatLinkInterceptor';
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

const instrumentSerif = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  variable: "--font-instrument-serif",
  display: "swap",
});

const ibmPlexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-ibm-plex-sans",
  display: "swap",
});

const ibmPlexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-ibm-plex-mono",
  display: "swap",
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
      <body className={`${outfit.className} ${instrumentSerif.variable} ${ibmPlexSans.variable} ${ibmPlexMono.variable} dark:bg-gray-900`}>
        <ThemeProvider>
          <ChatModalProvider>
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
          <ChatLinkInterceptor />
          <ChatModal />
          </ChatModalProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
