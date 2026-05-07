"use client";

import React from "react";
import { useTheme } from "@/components/ThemeProvider";

export default function FloatingThemeToggle() {
  const { theme, toggleTheme, mounted } = useTheme();

  const ariaLabel = !mounted
    ? "Toggle theme"
    : theme === "dark"
      ? "Switch to light mode"
      : "Switch to dark mode";

  const label = !mounted ? "Theme" : theme === "dark" ? "Light" : "Dark";

  return (
    <button
      type="button"
      onClick={toggleTheme}
      disabled={!mounted}
      aria-label={ariaLabel}
      className="fixed left-4 bottom-4 z-30 px-3 py-2 rounded-full border border-border bg-card text-card-foreground shadow disabled:opacity-60"
    >
      {label}
    </button>
  );
}
