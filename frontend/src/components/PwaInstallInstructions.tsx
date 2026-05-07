"use client";

import React, { useEffect, useState } from "react";

/** Detect iOS device */
function isIos() {
  if (typeof window === "undefined") return false;
  return /iPad|iPhone|iPod/i.test(window.navigator.userAgent);
}

/** Detect Android device */
function isAndroid() {
  if (typeof window === "undefined") return false;
  return /Android/i.test(window.navigator.userAgent);
}

/** Check if running in standalone mode (already installed as PWA) */
function isStandalone() {
  if (typeof window === "undefined") return false;
  const nav = window.navigator as unknown as { standalone?: boolean };
  return (
    window.matchMedia?.("(display-mode: standalone)")?.matches === true ||
    nav.standalone === true
  );
}

/** Check if device is mobile */
function isMobile() {
  if (typeof window === "undefined") return false;
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
    window.navigator.userAgent
  );
}

type DeviceInfo = {
  ios: boolean;
  android: boolean;
  mobile: boolean;
  standalone: boolean;
  browser: "safari" | "chrome" | "firefox" | "edge" | "samsung" | "other";
};

function detectBrowser(): DeviceInfo["browser"] {
  if (typeof window === "undefined") return "other";
  const ua = window.navigator.userAgent.toLowerCase();
  
  if (ua.includes("samsungbrowser")) return "samsung";
  if (ua.includes("edg")) return "edge";
  if (ua.includes("firefox")) return "firefox";
  if (ua.includes("chrome") && !ua.includes("edg")) return "chrome";
  if (ua.includes("safari") && !ua.includes("chrome")) return "safari";
  
  return "other";
}

export default function PwaInstallInstructions() {
  const [device, setDevice] = useState<DeviceInfo | null>(null);

  useEffect(() => {
    setDevice({
      ios: isIos(),
      android: isAndroid(),
      mobile: isMobile(),
      standalone: isStandalone(),
      browser: detectBrowser(),
    });
  }, []);

  if (!device) {
    return (
      <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-theme-xs dark:border-gray-800 dark:bg-gray-900 sm:p-6">
        <div className="animate-pulse">
          <div className="h-4 w-32 bg-gray-200 dark:bg-gray-700 rounded mb-4"></div>
          <div className="h-3 w-full bg-gray-200 dark:bg-gray-700 rounded mb-2"></div>
          <div className="h-3 w-3/4 bg-gray-200 dark:bg-gray-700 rounded"></div>
        </div>
      </div>
    );
  }

  if (device.standalone) {
    return (
      <div className="rounded-2xl border border-green-200 bg-green-50 p-5 shadow-theme-xs dark:border-green-800 dark:bg-green-900/20 sm:p-6">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-green-100 dark:bg-green-800">
            <svg className="h-5 w-5 text-green-600 dark:text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <div>
            <h2 className="text-sm font-semibold text-green-800 dark:text-green-200">
              ✅ Aplikasi sudah terinstall!
            </h2>
            <p className="mt-1 text-sm text-green-700 dark:text-green-300">
              Anda sudah menggunakan MALIKA sebagai aplikasi.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // iOS Instructions
  if (device.ios) {
    return (
      <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-theme-xs dark:border-gray-800 dark:bg-gray-900 sm:p-6">
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl bg-gray-100 dark:bg-gray-800">
            <svg className="h-6 w-6 text-gray-600 dark:text-gray-400" viewBox="0 0 24 24" fill="currentColor">
              <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/>
            </svg>
          </div>
          <div className="flex-1">
            <h2 className="text-base font-semibold text-gray-800 dark:text-white/90">
              📱 Install MALIKA di iPhone/iPad
            </h2>
            
            {device.browser !== "safari" ? (
              <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-900/20">
                <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
                  ⚠️ Buka dengan Safari
                </p>
                <p className="mt-1 text-sm text-amber-700 dark:text-amber-300">
                  Fitur "Add to Home Screen" hanya tersedia di Safari. Buka link ini di Safari untuk melanjutkan.
                </p>
              </div>
            ) : null}
            
            <div className="mt-4 space-y-4">
              <div className="flex items-start gap-3">
                <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-brand-100 text-sm font-semibold text-brand-600 dark:bg-brand-900 dark:text-brand-400">
                  1
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    Ketuk tombol Share
                  </p>
                  <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                    Cari ikon <span className="inline-flex items-center">
                      <svg className="h-4 w-4 mx-1" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M16 5l-1.42 1.42-1.59-1.59V16h-2V4.83L9.41 6.42 8 5l4-4 4 4zm4 5v11c0 1.1-.9 2-2 2H6c-1.1 0-2-.9-2-2V10c0-1.1.9-2 2-2h3v2H6v11h12V10h-3V8h3c1.1 0 2 .9 2 2z"/>
                      </svg>
                    </span> di bagian bawah Safari
                  </p>
                </div>
              </div>
              
              <div className="flex items-start gap-3">
                <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-brand-100 text-sm font-semibold text-brand-600 dark:bg-brand-900 dark:text-brand-400">
                  2
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    Pilih "Add to Home Screen"
                  </p>
                  <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                    Scroll ke bawah di menu share dan ketuk opsi tersebut
                  </p>
                </div>
              </div>
              
              <div className="flex items-start gap-3">
                <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-brand-100 text-sm font-semibold text-brand-600 dark:bg-brand-900 dark:text-brand-400">
                  3
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    Ketuk "Add" di pojok kanan atas
                  </p>
                  <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                    Aplikasi MALIKA akan muncul di home screen Anda
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Android Instructions
  if (device.android) {
    return (
      <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-theme-xs dark:border-gray-800 dark:bg-gray-900 sm:p-6">
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl bg-gray-100 dark:bg-gray-800">
            <svg className="h-6 w-6 text-green-600" viewBox="0 0 24 24" fill="currentColor">
              <path d="M17.523 15.341c-.5 0-.922.42-.922.92v4.826l-9.11-9.11 1.615-1.616-4.07-2.373-.644 1.22 2.373 4.07-1.615 1.616 9.11 9.11h-4.825c-.5 0-.922.42-.922.92s.422.922.922.922h6.088c.5 0 .922-.422.922-.922v-6.088c0-.5-.422-.922-.922-.922zM6.477 8.659c.5 0 .922-.42.922-.92V2.913l9.11 9.11-1.615 1.616 4.07 2.373.644-1.22-2.373-4.07 1.615-1.616-9.11-9.11h4.825c.5 0 .922-.42.922-.92S14.065.154 13.565.154H7.477c-.5 0-.922.422-.922.922v6.088c0 .5.422.922.922.922z"/>
            </svg>
          </div>
          <div className="flex-1">
            <h2 className="text-base font-semibold text-gray-800 dark:text-white/90">
              📱 Install MALIKA di Android
            </h2>
            
            <div className="mt-4 space-y-4">
              {device.browser === "chrome" || device.browser === "edge" ? (
                <>
                  <div className="flex items-start gap-3">
                    <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-brand-100 text-sm font-semibold text-brand-600 dark:bg-brand-900 dark:text-brand-400">
                      1
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                        Ketuk menu ⋮ (tiga titik vertikal)
                      </p>
                      <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                        Terletak di pojok kanan atas browser
                      </p>
                    </div>
                  </div>
                  
                  <div className="flex items-start gap-3">
                    <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-brand-100 text-sm font-semibold text-brand-600 dark:bg-brand-900 dark:text-brand-400">
                      2
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                        Pilih "Install app" atau "Add to Home screen"
                      </p>
                      <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                        Teks mungkin berbeda tergantung versi browser
                      </p>
                    </div>
                  </div>
                  
                  <div className="flex items-start gap-3">
                    <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-brand-100 text-sm font-semibold text-brand-600 dark:bg-brand-900 dark:text-brand-400">
                      3
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                        Ketuk "Install" untuk konfirmasi
                      </p>
                      <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                        Aplikasi MALIKA akan terinstall dan muncul di home screen
                      </p>
                    </div>
                  </div>
                </>
              ) : device.browser === "samsung" ? (
                <>
                  <div className="flex items-start gap-3">
                    <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-brand-100 text-sm font-semibold text-brand-600 dark:bg-brand-900 dark:text-brand-400">
                      1
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                        Ketuk menu ≡ (tiga garis horizontal)
                      </p>
                      <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                        Terletak di pojok kanan bawah Samsung Browser
                      </p>
                    </div>
                  </div>
                  
                  <div className="flex items-start gap-3">
                    <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-brand-100 text-sm font-semibold text-brand-600 dark:bg-brand-900 dark:text-brand-400">
                      2
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                        Pilih "Add page to" → "Home screen"
                      </p>
                      <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                        Atau pilih "Install" jika tersedia
                      </p>
                    </div>
                  </div>
                </>
              ) : (
                <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 dark:border-blue-800 dark:bg-blue-900/20">
                  <p className="text-sm text-blue-700 dark:text-blue-300">
                    💡 Untuk pengalaman terbaik, buka halaman ini menggunakan Chrome atau Samsung Browser, lalu pilih "Install app" dari menu browser.
                  </p>
                </div>
              )}
            </div>
            
            <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800">
              <p className="text-sm text-gray-600 dark:text-gray-400">
                💡 <strong>Tip:</strong> Jika muncul banner "Install MALIKA" di bawah layar, ketuk langsung untuk install lebih cepat!
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Desktop Instructions
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-theme-xs dark:border-gray-800 dark:bg-gray-900 sm:p-6">
      <div className="flex items-start gap-4">
        <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl bg-gray-100 dark:bg-gray-800">
          <svg className="h-6 w-6 text-gray-600 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
        </div>
        <div className="flex-1">
          <h2 className="text-base font-semibold text-gray-800 dark:text-white/90">
            💻 Install MALIKA di Desktop
          </h2>
          
          <div className="mt-4 space-y-4">
            {device.browser === "chrome" || device.browser === "edge" ? (
              <>
                <div className="flex items-start gap-3">
                  <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-brand-100 text-sm font-semibold text-brand-600 dark:bg-brand-900 dark:text-brand-400">
                    1
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                      Cari ikon install di address bar
                    </p>
                    <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                      Biasanya berupa ikon ⊕ atau 📥 di sebelah kanan URL
                    </p>
                  </div>
                </div>
                
                <div className="flex items-start gap-3">
                  <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-brand-100 text-sm font-semibold text-brand-600 dark:bg-brand-900 dark:text-brand-400">
                    2
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                      Atau klik menu ⋮ → "Install MALIKA"
                    </p>
                    <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                      Menu browser terletak di pojok kanan atas
                    </p>
                  </div>
                </div>
                
                <div className="flex items-start gap-3">
                  <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-brand-100 text-sm font-semibold text-brand-600 dark:bg-brand-900 dark:text-brand-400">
                    3
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                      Klik "Install" pada dialog konfirmasi
                    </p>
                    <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                      Aplikasi akan terinstall dan bisa diakses dari desktop/start menu
                    </p>
                  </div>
                </div>
              </>
            ) : device.browser === "firefox" ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-900/20">
                <p className="text-sm text-amber-700 dark:text-amber-300">
                  ⚠️ Firefox belum sepenuhnya mendukung instalasi PWA. Untuk pengalaman terbaik, gunakan Chrome atau Edge, atau bookmark halaman ini untuk akses cepat.
                </p>
              </div>
            ) : (
              <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 dark:border-blue-800 dark:bg-blue-900/20">
                <p className="text-sm text-blue-700 dark:text-blue-300">
                  💡 Buka halaman ini menggunakan Chrome atau Microsoft Edge untuk dapat menginstall sebagai aplikasi desktop.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
