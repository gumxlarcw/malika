import type { Delta } from "./types";

/**
 * The only place dashboard numbers become strings.
 *
 * `unit_multiplier` is deliberately absent: the flag disagrees with its own data
 * (source 179 "Rumah Tangga" carries raw counts, source 186 "Penduduk" genuinely
 * thousands, both flagged 3/"ribu"), so applying it would inflate one by a
 * thousand and labelling with it would mislabel the other. Values are shown
 * exactly as BPS replicated them. See the spec's risks section.
 */

const DEFAULT_DECIMALS = 2;

export function formatValue(value: number, decimalPlaces: number | null): string {
  const digits = decimalPlaces == null ? DEFAULT_DECIMALS : Math.max(0, Math.min(6, decimalPlaces));
  return new Intl.NumberFormat("id-ID", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

export function formatDelta(
  delta: Delta | null,
  decimalPlaces: number | null
): { text: string; direction: "up" | "down" | "flat" } | null {
  if (!delta) return null;
  const direction = delta.absolute > 0 ? "up" : delta.absolute < 0 ? "down" : "flat";
  return { text: formatValue(Math.abs(delta.absolute), decimalPlaces), direction };
}

/**
 * Units arrive as stored strings that may contain a superscript, e.g.
 * `km<sup>2</sup>`. Only that one tag is understood; everything else is
 * stripped, so the value can be rendered as plain React children with no
 * `dangerouslySetInnerHTML` anywhere.
 */
export function parseUnit(unit: string | null): Array<{ text: string; sup: boolean }> {
  if (!unit) return [];
  const parts: Array<{ text: string; sup: boolean }> = [];
  const pattern = /<sup>([^<]*)<\/sup>/gi;
  let cursor = 0;
  let match: RegExpExecArray | null;

  const pushPlain = (raw: string) => {
    const text = raw.replace(/<[^>]*>/g, "").trim();
    if (text) parts.push({ text, sup: false });
  };

  while ((match = pattern.exec(unit)) !== null) {
    pushPlain(unit.slice(cursor, match.index));
    const sup = match[1].replace(/<[^>]*>/g, "").trim();
    if (sup) parts.push({ text: sup, sup: true });
    cursor = match.index + match[0].length;
  }
  pushPlain(unit.slice(cursor));
  return parts;
}
