"use client";

import { Modal } from "@/components/ui";

type Props = {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  lines: string[];
  ok: boolean | null;
  error: string;
  showProgress?: {
    done: number;
    total: number;
    percent: number | null;
  } | null;
};

export default function LogModal({ isOpen, onClose, title, lines, ok, error, showProgress }: Props) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} size="xl">
      <div className="space-y-3">
        {/* Progress bar for batch operations */}
        {showProgress && showProgress.total > 0 && (
          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Progress: {showProgress.done}/{showProgress.total}</span>
              {showProgress.percent != null && <span>{Math.round(showProgress.percent)}%</span>}
            </div>
            <div className="w-full bg-muted rounded h-2 overflow-hidden">
              <div
                className="h-full bg-primary transition-all"
                style={{ width: `${showProgress.percent ?? 0}%` }}
              />
            </div>
          </div>
        )}

        {/* Status indicator */}
        {ok !== null && (
          <div className={`text-sm font-medium ${ok ? "text-green-600" : "text-red-600"}`}>
            Status: {ok ? "OK" : "Error"}
          </div>
        )}

        {/* Error message */}
        {error && (
          <div className="text-sm text-red-600 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded p-2">
            {error}
          </div>
        )}

        {/* Log output */}
        <div className="max-h-96 overflow-auto rounded border border-border bg-muted p-3">
          {lines.length === 0 ? (
            <div className="text-xs text-muted-foreground italic">Belum ada log…</div>
          ) : (
            <pre className="text-xs whitespace-pre-wrap font-mono">{lines.join("\n")}</pre>
          )}
        </div>

        <div className="flex justify-end">
          <button className="px-3 py-2 rounded border border-border" onClick={onClose}>
            Tutup
          </button>
        </div>
      </div>
    </Modal>
  );
}
