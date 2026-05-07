/**
 * Centralized formatting utilities for dates, numbers, and other values
 * Used across all admin pages for consistent formatting
 */

/**
 * Format a date/datetime string for display
 * Uses Indonesian locale with Asia/Jayapura timezone (WIT)
 * 
 * @param dt - Date string, Date object, or null
 * @param options - Optional Intl.DateTimeFormatOptions
 * @returns Formatted date string or "-" if invalid
 */
export function formatDateTime(
  dt: string | Date | null | undefined,
  options?: Intl.DateTimeFormatOptions
): string {
  if (!dt) return "-";
  try {
    const defaultOptions: Intl.DateTimeFormatOptions = {
      timeZone: "Asia/Jayapura",
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    };
    return new Date(dt).toLocaleString("id-ID", options || defaultOptions);
  } catch {
    return typeof dt === "string" ? dt : "-";
  }
}

/**
 * Short alias for formatDateTime - matches legacy fmt() function
 * 
 * @param dt - Date string or null
 * @returns Formatted date string or "-"
 */
export function fmt(dt: string | null | undefined): string {
  return formatDateTime(dt);
}

/**
 * Format date only (without time)
 * 
 * @param dt - Date string, Date object, or null
 * @returns Formatted date string or "-"
 */
export function formatDate(dt: string | Date | null | undefined): string {
  if (!dt) return "-";
  try {
    return new Date(dt).toLocaleDateString("id-ID", {
      timeZone: "Asia/Jayapura",
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return typeof dt === "string" ? dt : "-";
  }
}

/**
 * Format time only
 * 
 * @param dt - Date string, Date object, or null
 * @returns Formatted time string or "-"
 */
export function formatTime(dt: string | Date | null | undefined): string {
  if (!dt) return "-";
  try {
    return new Date(dt).toLocaleTimeString("id-ID", {
      timeZone: "Asia/Jayapura",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return typeof dt === "string" ? dt : "-";
  }
}

/**
 * Format bytes to human-readable size
 * 
 * @param bytes - Number of bytes
 * @returns Human-readable size string (e.g., "1.5 MB")
 */
export function formatBytes(bytes: number | null | undefined): string {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n < 0) return "-";
  if (n < 1024) return `${n} B`;
  
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  
  return `${v.toFixed(v >= 10 ? 0 : 1)} ${units[i]}`;
}

/**
 * Format number with thousand separators
 * 
 * @param num - Number to format
 * @returns Formatted number string
 */
export function formatNumber(num: number | null | undefined): string {
  if (num === null || num === undefined) return "-";
  if (!Number.isFinite(num)) return "-";
  return num.toLocaleString("id-ID");
}

/**
 * Format percentage
 * 
 * @param value - Value (0-100 or 0-1 depending on isDecimal)
 * @param decimals - Number of decimal places
 * @param isDecimal - If true, value is 0-1 and will be multiplied by 100
 * @returns Formatted percentage string
 */
export function formatPercent(
  value: number | null | undefined,
  decimals: number = 0,
  isDecimal: boolean = false
): string {
  if (value === null || value === undefined) return "-";
  if (!Number.isFinite(value)) return "-";
  const pct = isDecimal ? value * 100 : value;
  return `${pct.toFixed(decimals)}%`;
}

/**
 * Truncate text with ellipsis
 * 
 * @param text - Text to truncate
 * @param maxLen - Maximum length
 * @returns Truncated text
 */
export function truncate(text: string | null | undefined, maxLen: number = 100): string {
  if (!text) return "";
  return text.length > maxLen ? text.slice(0, maxLen) + "…" : text;
}

/**
 * Get the maximum date from two date strings
 * 
 * @param a - First date string
 * @param b - Second date string
 * @returns The later date string, or the one that's valid
 */
export function maxDate(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  const da = new Date(a).getTime();
  const db = new Date(b).getTime();
  if (!Number.isFinite(da)) return b;
  if (!Number.isFinite(db)) return a;
  return da >= db ? a : b;
}

/**
 * Clamp a percentage value between 0 and 100
 * 
 * @param n - Value to clamp
 * @returns Clamped value between 0-100
 */
export function clampPercent(n: unknown): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, v));
}
