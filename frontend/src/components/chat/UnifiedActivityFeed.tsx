"use client";

/**
 * UnifiedActivityFeed — Unified pipeline progress + thinking feed component.
 *
 * Sub-components and helpers live in ./feed/:
 *  - feedTypes.ts       — types, constants, color maps
 *  - feedHelpers.ts     — buildFeedSegments() layout algorithm
 *  - FeedComponents.tsx — all visual row/card components
 *
 * Two modes:
 *  - isStreaming=true  → live feed with shimmer, auto-scroll, stop button
 *  - isStreaming=false → collapsed toggle ("Lihat proses berpikir")
 */

import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
import TimingBar, { buildSegmentsFromSteps, buildSegmentsFromTimings } from "@/components/chat/TimingBar";

// Re-export ProcessStep so external consumers can import from this file
export type { ProcessStep } from "./feed/feedTypes";
export type { UnifiedActivityFeedProps } from "./feed/feedTypes";

import type { UnifiedActivityFeedProps } from "./feed/feedTypes";
import { isTerminalStatus } from "./feed/feedTypes";
import { buildFeedSegments } from "./feed/feedHelpers";
import {
  ProgressBar,
  TotalElapsed,
  ThinkingRow,
  PipelineStepRow,
  ParallelGroupRow,
  OrchestratorCard,
  ToolCallCard,
  ActionButtons,
  StreamingHeader,
  HistoricalHeader,
  InitialLoader,
} from "./feed/FeedComponents";

/* ================================================================== */
/*  MAIN COMPONENT                                                     */
/* ================================================================== */
export const UnifiedActivityFeed: React.FC<UnifiedActivityFeedProps> = ({
  steps,
  thinkingItems,
  toolCalls = [],
  isTyping,
  visible,
  fallbackLabel = "Memproses...",
  onStop,
  onRetry,
  onEdit,
  wasStopped = false,
  isHistorical = false,
  isExpanded: controlledExpanded,
  onToggle: controlledToggle,
  pipelineMs,
  modelId,
}) => {
  // Expansion state — internal for streaming, controlled for historical
  const [internalExpanded, setInternalExpanded] = useState(true);
  const isExpanded = isHistorical ? (controlledExpanded ?? false) : internalExpanded;

  // Track if user manually expanded — prevents auto-collapse from overriding
  const userExpandedRef = useRef(false);

  const toggleExpanded = useCallback(() => {
    if (isHistorical && controlledToggle) {
      controlledToggle();
    } else {
      setInternalExpanded((v) => {
        if (!v) userExpandedRef.current = true; // user is expanding → lock
        return !v;
      });
    }
  }, [isHistorical, controlledToggle]);

  const containerRef = useRef<HTMLDivElement>(null);
  const prevThinkingLenRef = useRef(0);

  // Auto-scroll pause: user scrolling up pauses auto-scroll, resume button brings it back
  const [autoScrollPaused, setAutoScrollPaused] = useState(false);
  const isUserScrollingRef = useRef(false);

  // Detect user scroll — pause auto-scroll when scrolled away from bottom
  useEffect(() => {
    if (isHistorical) return;
    const el = containerRef.current;
    if (!el) return;
    const onScroll = () => {
      // "At bottom" = within 30px of scroll end
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 30;
      if (atBottom) {
        setAutoScrollPaused(false);
      } else if (isUserScrollingRef.current) {
        setAutoScrollPaused(true);
      }
    };
    // Mark user-initiated scrolls (vs programmatic)
    const onPointer = () => { isUserScrollingRef.current = true; };
    const onPointerUp = () => { setTimeout(() => { isUserScrollingRef.current = false; }, 100); };
    el.addEventListener("scroll", onScroll, { passive: true });
    el.addEventListener("pointerdown", onPointer);
    el.addEventListener("wheel", onPointer, { passive: true });
    window.addEventListener("pointerup", onPointerUp);
    return () => {
      el.removeEventListener("scroll", onScroll);
      el.removeEventListener("pointerdown", onPointer);
      el.removeEventListener("wheel", onPointer);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, [isHistorical]);

  // Reset pause state when streaming stops or new query starts
  useEffect(() => {
    if (!isTyping || steps.length === 0) setAutoScrollPaused(false);
  }, [isTyping, steps.length]);

  const resumeAutoScroll = useCallback(() => {
    setAutoScrollPaused(false);
    const el = containerRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, []);

  // Track how many items existed at mount time — skip entry animations for those (restore scenario)
  const mountItemCountRef = useRef(thinkingItems.length);
  const mountStepCountRef = useRef(steps.length);

  // Auto-expand when new thinking items arrive (streaming mode)
  useEffect(() => {
    if (isHistorical) return;
    if (thinkingItems.length > prevThinkingLenRef.current) {
      setInternalExpanded(true);
    }
    prevThinkingLenRef.current = thinkingItems.length;
  }, [thinkingItems.length, isHistorical]);

  // Auto-scroll to bottom when new thinking items arrive (respects pause)
  useEffect(() => {
    if (isHistorical || autoScrollPaused) return;
    const el = containerRef.current;
    if (el && thinkingItems.length > 0) {
      requestAnimationFrame(() => {
        el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
      });
    }
  }, [thinkingItems.length, toolCalls.length, isHistorical, autoScrollPaused]);

  // Auto-collapse after all done + delay (streaming mode)
  // Respects userExpandedRef — if user manually expanded, don't auto-collapse
  const allStepsDone = steps.length > 0 && steps.every((s) => isTerminalStatus(s.status));
  useEffect(() => {
    if (isHistorical) return;
    if (allStepsDone && !isTyping && !userExpandedRef.current) {
      // Dynamic delay: more steps / longer pipeline = more reading time
      const firstStart = steps.length > 0 ? Math.min(...steps.map((s) => s.startedAt).filter(Boolean)) : 0;
      const lastEnd = Math.max(...steps.map((s) => s.doneAt ?? s.startedAt));
      const totalElapsed = firstStart ? lastEnd - firstStart : 0;
      const delay = Math.max(3000, thinkingItems.length * 500, Math.min(10000, totalElapsed * 0.3));
      const t = setTimeout(() => setInternalExpanded(false), delay);
      return () => clearTimeout(t);
    }
  }, [allStepsDone, isTyping, isHistorical, steps, thinkingItems.length]);

  // Reset userExpandedRef when a new query starts (steps cleared)
  useEffect(() => {
    if (steps.length === 0) {
      userExpandedRef.current = false;
    }
  }, [steps.length]);

  // Build feed segments — includes pending stages when streaming
  const isStreamingMode = !isHistorical && isTyping;
  const feedSegments = useMemo(
    () => buildFeedSegments(thinkingItems, toolCalls, steps, isStreamingMode),
    [thinkingItems, toolCalls, steps, isStreamingMode],
  );

  const hasContent = thinkingItems.length > 0 || toolCalls.length > 0;
  const hasSteps = steps.length > 0;

  // ── Historical (post-stream) mode ──
  if (isHistorical) {
    if (!hasContent) return null;
    return (
      <div className="malika-thinking-section mb-2 transition-all duration-300 ease-in-out">
        <HistoricalHeader
          thinkingItems={thinkingItems}
          isExpanded={isExpanded}
          onToggle={toggleExpanded}
          pipelineMs={pipelineMs}
          modelId={modelId}
        />
        <div
          className="grid transition-[grid-template-rows,opacity] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]"
          style={{ gridTemplateRows: isExpanded ? "1fr" : "0fr", opacity: isExpanded ? 1 : 0, marginTop: isExpanded ? "0.5rem" : 0 }}
        >
          <div className="overflow-hidden">
            <div className="overflow-y-auto max-h-[26rem] rounded-xl bg-gray-50/50 p-3 dark:bg-gray-900/30">
              {pipelineMs && <TimingBar segments={buildSegmentsFromTimings(pipelineMs)} minSegments={1} />}
              <div className="relative space-y-1.5" role="list">
                {feedSegments.length > 1 && (
                  <div className="absolute left-[15px] top-3 bottom-3 w-px bg-gradient-to-b from-brand-200 via-gray-200 to-transparent dark:from-brand-800/50 dark:via-gray-700/50" />
                )}
                {feedSegments.map((seg, i) => {
                  if (seg.type === "parallel-group") {
                    return (
                      <ParallelGroupRow
                        key={`pgrp-${i}`}
                        label={seg.label}
                        stages={seg.stages}
                        isTyping={false}
                        isLastGroup={false}
                        skipAnimation
                        renderChildren={(childSeg: any, isLast: boolean) => {
                          if (childSeg.type !== "pipeline-step") return null;
                          const hasChildren = childSeg.thinkingChildren.length > 0 || childSeg.toolChildren.length > 0 || childSeg.orchChildren.length > 0;
                          return (
                            <PipelineStepRow key={`pipe-${childSeg.step.stage}`} step={childSeg.step} isLast={isLast} idx={childSeg.idx} skipAnimation>
                              {hasChildren && (
                                <>
                                  {childSeg.thinkingChildren.map((item: any, j: number) => (
                                    <ThinkingRow key={`th-${childSeg.step.stage}-${j}`} item={item} isLast={false} isStreaming={false} idx={j} />
                                  ))}
                                  {childSeg.orchChildren.length > 0 && <OrchestratorCard items={childSeg.orchChildren} isStreaming={false} />}
                                  {childSeg.toolChildren.length > 0 && (
                                    <div className="flex flex-col gap-1.5">{childSeg.toolChildren.map((tc: any) => <ToolCallCard key={tc.callId} tc={tc} />)}</div>
                                  )}
                                </>
                              )}
                            </PipelineStepRow>
                          );
                        }}
                      />
                    );
                  }
                  if (seg.type === "pipeline-step") {
                    const hasChildren = seg.thinkingChildren.length > 0 || seg.toolChildren.length > 0 || seg.orchChildren.length > 0;
                    return (
                      <PipelineStepRow
                        key={`pipe-${seg.step.stage}`}
                        step={seg.step}
                        isLast={false}
                        idx={seg.idx}
                        skipAnimation
                      >
                        {hasChildren && (
                          <>
                            {seg.thinkingChildren.map((item, j) => (
                              <ThinkingRow key={`th-${seg.step.stage}-${j}`} item={item} isLast={false} isStreaming={false} idx={j} />
                            ))}
                            {seg.orchChildren.length > 0 && (
                              <OrchestratorCard items={seg.orchChildren} isStreaming={false} />
                            )}
                            {seg.toolChildren.length > 0 && (
                              <div className="flex flex-col gap-1.5">
                                {seg.toolChildren.map((tc) => <ToolCallCard key={tc.callId} tc={tc} />)}
                              </div>
                            )}
                          </>
                        )}
                      </PipelineStepRow>
                    );
                  }
                  if (seg.type === "orchestrator-card") {
                    return <OrchestratorCard key={`orch-${i}`} items={seg.items} isStreaming={false} />;
                  }
                  if (seg.type === "tool-calls") {
                    return (
                      <div key="tools" className="flex flex-col gap-1.5 ml-0.5">
                        {seg.toolCalls.map((tc) => <ToolCallCard key={tc.callId} tc={tc} />)}
                      </div>
                    );
                  }
                  return <ThinkingRow key={seg.idx} item={seg.item} isLast={false} isStreaming={false} idx={seg.idx} />;
                })}
              </div>
            </div>
            <div className="pointer-events-none absolute right-0 bottom-0 left-0 h-6 rounded-b-xl bg-gradient-to-t from-gray-50 to-transparent dark:from-gray-900/50" />
          </div>
        </div>
      </div>
    );
  }

  // ── Streaming (live) mode ──
  if (!visible && !hasSteps && !hasContent) return null;

  return (
    <div
      className={`process-indicator-wrapper transition-[opacity] duration-400 ease-out ${visible ? "opacity-100" : "opacity-0 pointer-events-none"}`}
      role="status"
      aria-live="polite"
    >
      {hasSteps || hasContent ? (
        <div>
          <StreamingHeader
            steps={steps}
            thinkingItems={thinkingItems}
            isTyping={isTyping}
            isExpanded={isExpanded}
            onToggle={toggleExpanded}
            modelId={modelId}
          />

          <div
            className="grid transition-[grid-template-rows,opacity] duration-300 ease-out"
            style={{ gridTemplateRows: isExpanded ? "1fr" : "0fr" }}
          >
            <div className="overflow-hidden">
              {/* Progress bar from pipeline stages */}
              <div className="mx-2 mb-2">
                <ProgressBar steps={steps} modelId={modelId} />
              </div>
              {/* TimingBar shows when pipeline is complete */}
              {steps.length > 0 && steps.every((s) => isTerminalStatus(s.status)) && (
                <div className="mx-2 mb-1">
                  <TimingBar segments={buildSegmentsFromSteps(steps)} />
                </div>
              )}

              {/* Activity Feed — thinking items + tool calls + orchestrator */}
              <div ref={containerRef} className="custom-scrollbar max-h-[350px] overflow-y-auto px-3 pb-2">
                <div className="relative space-y-1.5" role="list">
                  {/* Timeline line */}
                  {feedSegments.length > 1 && (
                    <div className="absolute left-[15px] top-3 bottom-3 w-px bg-gradient-to-b from-brand-200 via-gray-200 to-transparent dark:from-brand-800/50 dark:via-gray-700/50" />
                  )}
                  {feedSegments.map((seg, i) => {
                    if (seg.type === "parallel-group") {
                      const isLastSeg = i === feedSegments.length - 1;
                      return (
                        <ParallelGroupRow
                          key={`pgrp-${i}`}
                          label={seg.label}
                          stages={seg.stages}
                          isTyping={isTyping}
                          isLastGroup={isLastSeg}
                          renderChildren={(childSeg: any, isLast: boolean) => {
                            if (childSeg.type !== "pipeline-step") return null;
                            const hasChildren = childSeg.thinkingChildren.length > 0 || childSeg.toolChildren.length > 0 || childSeg.orchChildren.length > 0;
                            return (
                              <PipelineStepRow key={`pipe-${childSeg.step.stage}`} step={childSeg.step} isLast={isLast} idx={childSeg.idx} skipAnimation={childSeg.idx < mountStepCountRef.current}>
                                {hasChildren && (
                                  <>
                                    {childSeg.thinkingChildren.map((item: any, j: number) => (
                                      <ThinkingRow key={`th-${childSeg.step.stage}-${j}`} item={item} isLast={false} isStreaming={isTyping} idx={j} />
                                    ))}
                                    {childSeg.orchChildren.length > 0 && <OrchestratorCard items={childSeg.orchChildren} isStreaming={isTyping} />}
                                    {childSeg.toolChildren.length > 0 && (
                                      <div className="flex flex-col gap-1.5">{childSeg.toolChildren.map((tc: any) => <ToolCallCard key={tc.callId} tc={tc} />)}</div>
                                    )}
                                  </>
                                )}
                              </PipelineStepRow>
                            );
                          }}
                        />
                      );
                    }
                    if (seg.type === "pipeline-step") {
                      const isLastSeg = i === feedSegments.length - 1;
                      const hasChildren = seg.thinkingChildren.length > 0 || seg.toolChildren.length > 0 || seg.orchChildren.length > 0;
                      return (
                        <PipelineStepRow
                          key={`pipe-${seg.step.stage}`}
                          step={seg.step}
                          isLast={isLastSeg}
                          idx={seg.idx}
                          skipAnimation={seg.idx < mountStepCountRef.current}
                        >
                          {hasChildren && (
                            <>
                              {seg.thinkingChildren.map((item, j) => (
                                <ThinkingRow
                                  key={`th-${seg.step.stage}-${j}`}
                                  item={item}
                                  isLast={false}
                                  isStreaming={isTyping}
                                  idx={j}
                                />
                              ))}
                              {seg.orchChildren.length > 0 && (
                                <OrchestratorCard items={seg.orchChildren} isStreaming={isTyping} />
                              )}
                              {seg.toolChildren.length > 0 && (
                                <div className="flex flex-col gap-1.5">
                                  {seg.toolChildren.map((tc) => (
                                    <ToolCallCard key={tc.callId} tc={tc} />
                                  ))}
                                </div>
                              )}
                            </>
                          )}
                        </PipelineStepRow>
                      );
                    }
                    if (seg.type === "orchestrator-card") {
                      return <OrchestratorCard key={`orch-${i}`} items={seg.items} isStreaming={isTyping} />;
                    }
                    if (seg.type === "tool-calls") {
                      return (
                        <div key="tools" className="flex flex-col gap-1.5 ml-0.5">
                          {seg.toolCalls.map((tc) => <ToolCallCard key={tc.callId} tc={tc} />)}
                        </div>
                      );
                    }
                    return (
                      <ThinkingRow
                        key={seg.idx}
                        item={seg.item}
                        isLast={i === feedSegments.length - 1 && !isTyping}
                        isStreaming={isTyping && seg.idx >= mountItemCountRef.current}
                        idx={seg.idx < mountItemCountRef.current ? 0 : seg.idx - mountItemCountRef.current}
                      />
                    );
                  })}
                </div>
              </div>
              {/* Resume auto-scroll button — shown when user scrolled up during streaming */}
              {autoScrollPaused && isTyping && (
                <div className="flex justify-center py-1">
                  <button
                    type="button"
                    onClick={resumeAutoScroll}
                    className="inline-flex items-center gap-1 rounded-full bg-brand-500/90 px-2.5 py-1 text-[10px] font-medium text-white shadow-sm hover:bg-brand-600 transition-colors animate-fade-in"
                  >
                    <svg className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 3a.75.75 0 01.75.75v10.638l3.96-4.158a.75.75 0 111.08 1.04l-5.25 5.5a.75.75 0 01-1.08 0l-5.25-5.5a.75.75 0 111.08-1.04l3.96 4.158V3.75A.75.75 0 0110 3z" clipRule="evenodd" /></svg>
                    Lanjut ikuti
                  </button>
                </div>
              )}
            </div>
          </div>

          <ActionButtons
            isTyping={isTyping}
            wasStopped={wasStopped}
            onStop={onStop}
            onRetry={onRetry}
            onEdit={onEdit}
          />
        </div>
      ) : (
        <InitialLoader label={fallbackLabel} />
      )}
    </div>
  );
};

export default UnifiedActivityFeed;
