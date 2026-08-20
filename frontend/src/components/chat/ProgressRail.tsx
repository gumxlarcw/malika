"use client";

import React from "react";
import type { ProcessStepLike } from "./UnifiedThinkingCard";

/**
 * ProgressRail — "Rel Terukur"
 *
 * One numbered rail through the nine pipeline stages. Parallel work (3–5) is
 * bracketed under a single heading rather than pretending to be sequential.
 *
 * All nine are drawn from the first second, greyed until they run. The panel this
 * replaces showed a single status line, so the ~13-18s before the first reasoning
 * token read as a hang — the reader could not tell how much was left. Steps
 * appearing one at a time has the same problem in slower motion.
 *
 * Every row is backed by a real SSE `status` event from streaming.service.js.
 * Three of the nine (dna, deepdive, format) were added there for this panel; none
 * of the rows are inferred or faked from timing.
 */

export interface RailStep {
  n: number;
  key: string;
  label: string;
  group?: string;
}

/** Order matches the pipeline, not the order the emits appear in the source. */
export const RAIL: RailStep[] = [
  { n: 1, key: "normalize", label: "Memahami pertanyaan" },
  { n: 2, key: "dna", label: "Analisis DNA data" },
  { n: 3, key: "search", label: "Mencari indikator", group: "Pencarian data" },
  { n: 4, key: "knowledge", label: "Mencari referensi", group: "Pencarian data" },
  { n: 5, key: "preview", label: "Menyiapkan data", group: "Pencarian data" },
  { n: 6, key: "thinking", label: "Menganalisis" },
  { n: 7, key: "deepdive", label: "Sub-analisis mendalam" },
  { n: 8, key: "generating", label: "Menyusun jawaban" },
  { n: 9, key: "format", label: "Memformat hasil" },
];

type State = "done" | "active" | "pending";

/** Indonesian decimals: 0,4s — not 0.4s. */
export function fmtSecs(ms?: number): string {
  if (!ms || ms < 0) return "";
  return `${(ms / 1000).toFixed(1).replace(".", ",")}s`;
}

interface RailModelRow {
  step: RailStep;
  state: State;
  elapsedMs?: number;
  detail?: string;
}

/**
 * Fold the SSE step list onto the rail.
 *
 * A stage is done once any later stage has been seen — the backend does not send
 * a "finished" event per stage, and waiting for one would leave completed rows
 * spinning for the rest of the turn.
 */
export function buildRail(steps: ProcessStepLike[]): RailModelRow[] {
  const byKey = new Map(steps.map((s) => [s.stage, s]));
  let lastSeen = -1;
  RAIL.forEach((r, i) => {
    if (byKey.has(r.key)) lastSeen = i;
  });

  return RAIL.map((step, i) => {
    const hit = byKey.get(step.key);
    let state: State = "pending";
    if (i < lastSeen) state = "done";
    else if (i === lastSeen) state = "active";

    // Server-measured when available. The client fallback times the gap between
    // consecutive status events, which is the right answer only for stages that
    // are announced where they actually run.
    const clientElapsed =
      hit?.doneAt && hit?.startedAt ? hit.doneAt - hit.startedAt : undefined;
    const elapsedMs = hit?.elapsedMs ?? clientElapsed;
    return { step, state, elapsedMs, detail: hit?.detail };
  });
}

const DOT = {
  done: "#465fff",
  active: "#465fff",
  pending: "#e4e7ec",
} as const;

const Num: React.FC<{ n: string; state: State }> = ({ n, state }) => (
  <span
    className="grid place-items-center shrink-0 rounded-full font-semibold"
    style={{
      width: 24,
      height: 24,
      fontSize: n.length > 1 ? 9.5 : 11.5,
      fontFamily: n.length > 1 ? "'IBM Plex Mono', monospace" : undefined,
      background: state === "pending" ? "#f2f4f7" : DOT[state],
      color: state === "pending" ? "#98a2b3" : "#fff",
    }}
  >
    {n}
  </span>
);

const Row: React.FC<{
  num: string;
  title: string;
  state: State;
  secs?: string;
  chip?: string;
  last?: boolean;
  children?: React.ReactNode;
}> = ({ num, title, state, secs, chip, last, children }) => (
  <div className="flex gap-3">
    <div className="flex flex-col items-center" style={{ width: 24 }}>
      <Num n={num} state={state} />
      {!last && (
        <span
          className="flex-1"
          style={{ width: 1, minHeight: 12, background: state === "pending" ? "#e4e7ec" : "#c2d6ff" }}
        />
      )}
    </div>
    <div className="flex-1 pb-2.5 min-w-0">
      <div className="flex items-baseline gap-2.5">
        <span
          className="truncate"
          style={{
            font: "500 13px/24px Outfit, system-ui, sans-serif",
            color: state === "pending" ? "#98a2b3" : "#101828",
          }}
        >
          {title}
        </span>
        {chip && (
          <span style={{ font: "400 11px/24px 'IBM Plex Mono', monospace", color: "#667085" }}>
            {chip}
          </span>
        )}
        <span className="flex-1" />
        {secs && (
          <span style={{ font: "400 11.5px/24px 'IBM Plex Mono', monospace", color: "#98a2b3" }}>
            {secs}
          </span>
        )}
        {state === "pending" && !secs && (
          <span style={{ font: "400 10.5px/24px 'IBM Plex Mono', monospace", color: "#c2c8d0" }}>
            MENUNGGU
          </span>
        )}
      </div>
      {children}
    </div>
  </div>
);

const Detail: React.FC<{ text: string }> = ({ text }) => (
  <div className="flex items-start gap-[7px] pb-0.5">
    <span
      className="shrink-0 rounded-full"
      style={{ width: 4, height: 4, marginTop: 6, background: "#12b76a" }}
    />
    <span style={{ font: "400 12px/16px Outfit, system-ui, sans-serif", color: "#475467" }}>
      {text}
    </span>
  </div>
);

interface Props {
  steps: ProcessStepLike[];
  isStreaming: boolean;
  onStop?: () => void;
  elapsedMs: number;
}

export const ProgressRail: React.FC<Props> = ({ steps, isStreaming, onStop, elapsedMs }) => {
  const rows = buildRail(steps);
  const activeIdx = rows.findIndex((r) => r.state === "active");
  const doneCount = rows.filter((r) => r.state === "done").length;
  const current = activeIdx >= 0 ? rows[activeIdx] : undefined;
  const nn = String(Math.max(doneCount + (current ? 1 : 0), 1)).padStart(2, "0");

  const group = rows.filter((r) => r.step.group);
  const groupState: State = group.some((r) => r.state === "active")
    ? "active"
    : group.every((r) => r.state === "done")
      ? "done"
      : group.some((r) => r.state === "done")
        ? "active"
        : "pending";

  return (
    <div>
      {/* header */}
      <div className="flex items-center gap-2.5 px-4 pt-3.5 pb-2.5">
        <span className="relative grid place-items-center shrink-0" style={{ width: 8, height: 8 }}>
          {isStreaming && (
            <span
              className="malika-pulse absolute inset-0 rounded-full"
              style={{ background: "rgba(70,95,255,.22)" }}
            />
          )}
          <span className="relative rounded-full" style={{ width: 8, height: 8, background: "#465fff" }} />
        </span>
        <span style={{ font: "600 13.5px/18px Outfit, system-ui, sans-serif", color: "#101828" }}>
          {isStreaming ? current?.step.label ?? "Menganalisis" : "Selesai"}
        </span>
        <span style={{ font: "400 12px/18px 'IBM Plex Mono', monospace", color: "#667085" }}>
          langkah {nn}/09
        </span>
        <span className="flex-1" />
        <span style={{ font: "500 12.5px/18px 'IBM Plex Mono', monospace", color: "#344054" }}>
          {fmtSecs(elapsedMs)}
        </span>
        {isStreaming && onStop && (
          <button
            type="button"
            onClick={onStop}
            className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 hover:bg-rose-50 dark:hover:bg-rose-500/10"
            style={{ font: "500 12px/16px Outfit, system-ui, sans-serif", color: "#f04438" }}
            aria-label="Hentikan"
          >
            <span style={{ width: 7, height: 7, background: "#f04438", borderRadius: 1 }} />
            Hentikan
          </button>
        )}
      </div>

      {/* nine-segment bar */}
      <div className="flex gap-[3px] px-4 pb-3.5" aria-hidden="true">
        {rows.map((r, i) => (
          <span
            key={i}
            className="flex-1"
            style={{
              height: 3,
              borderRadius: 2,
              background:
                r.state === "done"
                  ? "#465fff"
                  : r.state === "active"
                    ? "linear-gradient(90deg,#c2d6ff,#465fff)"
                    : "#e4e7ec",
            }}
          />
        ))}
      </div>

      {/* the rail */}
      <div className="px-4 pb-1">
        {rows.map((r, i) => {
          if (r.step.group) {
            if (r.step.n !== 3) return null;
            return (
              <Row
                key="grp"
                num="3–5"
                title="Pencarian data"
                state={groupState}
                chip="3 PROSES PARALEL"
                secs={undefined}
              >
                <div
                  className="flex flex-col gap-2.5 mt-1.5 pl-3"
                  style={{ borderLeft: "2px solid #dde9ff" }}
                >
                  {group.map((g) => (
                    <div key={g.step.key}>
                      <div className="flex items-baseline gap-2">
                        <span
                          className="grid place-items-center shrink-0 rounded"
                          style={{
                            width: 16,
                            height: 16,
                            background: g.state === "pending" ? "#f2f4f7" : "#ecf3ff",
                            font: "500 9.5px/16px 'IBM Plex Mono', monospace",
                            color: g.state === "pending" ? "#98a2b3" : "#3641f5",
                          }}
                        >
                          {g.step.n}
                        </span>
                        <span
                          className="truncate"
                          style={{
                            font: "500 12.5px/16px Outfit, system-ui, sans-serif",
                            color: g.state === "pending" ? "#98a2b3" : "#344054",
                          }}
                        >
                          {g.step.label}
                        </span>
                        <span className="flex-1" />
                        {g.elapsedMs != null && (
                          <span style={{ font: "400 11px/16px 'IBM Plex Mono', monospace", color: "#98a2b3" }}>
                            {fmtSecs(g.elapsedMs)}
                          </span>
                        )}
                      </div>
                      {g.detail && <div className="mt-1"><Detail text={g.detail} /></div>}
                    </div>
                  ))}
                </div>
              </Row>
            );
          }
          return (
            <Row
              key={r.step.key}
              num={String(r.step.n)}
              title={r.step.label}
              state={r.state}
              secs={r.elapsedMs != null ? fmtSecs(r.elapsedMs) : undefined}
              last={i === rows.length - 1}
            >
              {r.detail && <Detail text={r.detail} />}
            </Row>
          );
        })}
      </div>

      {/* anti-hang reassurance, only while the rail is still near the start */}
      {isStreaming && doneCount < 2 && (
        <div
          className="px-4 pb-3"
          style={{ font: "400 11.5px/16px Outfit, system-ui, sans-serif", color: "#98a2b3" }}
        >
          Pertanyaan seperti ini biasanya selesai dalam 15–25 detik.
        </div>
      )}
    </div>
  );
};

export default ProgressRail;
