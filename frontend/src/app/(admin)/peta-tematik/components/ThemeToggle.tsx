"use client";

import { useEffect, useState } from "react";
import { Sun, Moon } from "lucide-react";

const STORAGE_KEY = "peta-tematik-theme";

/**
 * Scoped theme toggle — affects `.peta-tematik-page` only via .dark suffix class.
 * Persists choice in localStorage. Initial value follows system preference.
 */
export default function ThemeToggle() {
  const [theme, setTheme] = useState<"light" | "dark">("light");

  // Hydrate from localStorage or system
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === "dark" || stored === "light") {
        setTheme(stored);
      } else if (typeof window !== "undefined" && window.matchMedia) {
        const sysDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
        setTheme(sysDark ? "dark" : "light");
      }
    } catch { /* ignore */ }
  }, []);

  // Apply class to .peta-tematik-page wrapper
  useEffect(() => {
    const wrapper = document.querySelector(".peta-tematik-page");
    if (!wrapper) return;
    if (theme === "dark") wrapper.classList.add("dark");
    else wrapper.classList.remove("dark");
    try { localStorage.setItem(STORAGE_KEY, theme); } catch { /* ignore */ }
  }, [theme]);

  const toggle = () => setTheme((t) => (t === "dark" ? "light" : "dark"));

  return (
    <button
      onClick={toggle}
      aria-label={theme === "dark" ? "Mode terang" : "Mode gelap"}
      title={theme === "dark" ? "Mode terang" : "Mode gelap"}
      className="flex items-center justify-center w-9 h-9 rounded-xl border border-[var(--pt-border)] hover:border-[var(--pt-border-strong)] hover:bg-[var(--pt-canvas-deep)] transition-colors text-[var(--pt-ink-soft)]"
    >
      {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
    </button>
  );
}
