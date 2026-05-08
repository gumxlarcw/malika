import React from "react";
import { formatCellValue } from "@/lib/chatUtils";

export const BPS_VALUE_CODE_LABELS: Record<string, string> = {
  r: "Angka revisi",
  "*": "Angka sementara",
  "**": "Angka sangat sementara",
  "***": "Angka sangat-sangat sementara",
  e: "Angka estimasi",
  p: "Angka proyeksi",
  x: "Data tidak tersedia",
};

export function getBpsValueCodeLabel(code: string | null | undefined): string | null {
  if (!code) return null;
  const trimmed = String(code).trim();
  if (!trimmed) return null;
  return BPS_VALUE_CODE_LABELS[trimmed] || `Catatan: ${trimmed}`;
}

export function renderCellWithCode(
  row: Record<string, unknown>,
  column: string
): React.ReactNode {
  const value = row[column];
  const text = formatCellValue(value, column);

  const codes = (row.value_codes ?? null) as Record<string, string> | null;
  const code = codes?.[column];
  if (!code) return text;

  const label = getBpsValueCodeLabel(code) || code;
  return (
    <>
      {text}
      <sup
        className="ml-0.5 text-[0.7em] font-medium text-brand-600 dark:text-brand-400 cursor-help"
        title={label}
      >
        {code}
      </sup>
    </>
  );
}
