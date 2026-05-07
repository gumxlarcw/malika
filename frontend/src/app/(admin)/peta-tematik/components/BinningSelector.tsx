"use client";
import { useState } from "react";
import { HelpCircle } from "lucide-react";
import { BINNING_LABELS, BINNING_DESCRIPTIONS, type BinningMethod } from "../colorScale";

interface Props {
  value: BinningMethod;
  onChange: (m: BinningMethod) => void;
}

const METHODS: BinningMethod[] = ["quantile", "jenks", "equal"];

export default function BinningSelector({ value, onChange }: Props) {
  const [showInfo, setShowInfo] = useState(false);
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="pt-eyebrow">Klasifikasi</span>
      <div className="inline-flex border border-[var(--pt-border-strong)] rounded-xl overflow-hidden">
        {METHODS.map((m, i) => (
          <button
            key={m}
            type="button"
            onClick={() => onChange(m)}
            className={`px-3 py-1.5 pt-mono text-[11px] uppercase tracking-wider transition-colors ${
              value === m
                ? "bg-[var(--pt-ink)] text-[var(--pt-canvas)]"
                : "bg-[var(--pt-canvas-elevated)] text-[var(--pt-ink-soft)] hover:bg-[var(--pt-canvas-deep)]"
            } ${i > 0 ? "border-l border-[var(--pt-border-strong)]" : ""}`}
          >
            {BINNING_LABELS[m]}
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={() => setShowInfo((s) => !s)}
        className="text-[var(--pt-ink-faint)] hover:text-[var(--pt-ink)] transition-colors"
        aria-label="Penjelasan metode klasifikasi"
      >
        <HelpCircle className="w-4 h-4" />
      </button>
      {showInfo && (
        <div className="basis-full mt-2 text-xs pt-body text-[var(--pt-ink-soft)] bg-[var(--pt-canvas-deep)] border border-[var(--pt-border)] rounded-xl p-3 leading-relaxed">
          <strong className="pt-display not-italic font-medium text-[var(--pt-ink)]">
            {BINNING_LABELS[value]}:
          </strong>{" "}
          {BINNING_DESCRIPTIONS[value]}.
        </div>
      )}
    </div>
  );
}
