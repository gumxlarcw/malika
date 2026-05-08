// Resolves a BPS value-code label/desc by reusing the project's existing dictionary
// (src/lib/cellRender.tsx) and adds an amber-chip class map for the redesigned superscript.
// The label/desc copy stays the source of truth in cellRender.tsx; here we only add styling.

import { getBpsValueCodeLabel } from "@/lib/cellRender";

export type ValueCodeInfo = {
  code: string;
  label: string;
  // Short tooltip-friendly desc; falls back to label when not available.
  desc: string;
};

export function describeValueCode(code: string | null | undefined): ValueCodeInfo | null {
  if (!code) return null;
  const label = getBpsValueCodeLabel(code);
  if (!label) return null;
  return { code, label, desc: label };
}

// Visible amber chip — far more legible than the original gray <sub>.
// Used inline next to numeric values; tabular flow guaranteed by parent.
export const VALUE_CODE_CHIP_CLASS =
  "ml-0.5 rounded px-1 font-semibold text-amber-700 bg-amber-100/70 dark:text-amber-300 dark:bg-amber-400/10 cursor-help";
