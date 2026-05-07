/**
 * feedHelpers — Segment builder for UnifiedActivityFeed.
 *
 * Builds the ordered list of FeedSegments from pipeline steps,
 * thinking items, and tool calls. This is the layout algorithm
 * that determines what appears in the activity feed timeline.
 */

import type { ThinkingItem } from "@/types/chat";
import type { TrackedToolCall } from "@/context/ChatProcessContext";
import {
  type ProcessStep,
  type FeedSegment,
  PIPELINE_STAGES,
  STAGE_FRIENDLY,
  THINKING_TO_STAGE,
  PARALLEL_GROUPS,
} from "./feedTypes";

/**
 * Build feed segments with pipeline steps as PRIMARY items.
 * ALL pipeline stages are shown: active/done stages from processSteps,
 * remaining stages as "pending" (greyed out).
 * Thinking items and tool calls are nested under their parent pipeline stage.
 * Any thinking/tool items that don't map to a pipeline stage appear at the end.
 */
export function buildFeedSegments(
  thinkingItems: ThinkingItem[],
  toolCalls: TrackedToolCall[],
  processSteps: ProcessStep[],
  showAllStages = false,
): FeedSegment[] {
  const segments: FeedSegment[] = [];

  // If we have pipeline steps (or showAllStages), they are the backbone
  if (processSteps.length > 0 || showAllStages) {
    // Group thinking items by their parent stage
    const thinkingByStage = new Map<string, ThinkingItem[]>();
    const orchByStage = new Map<string, ThinkingItem[]>();
    const unmappedThinking: ThinkingItem[] = [];

    for (const item of thinkingItems) {
      if (!item.step) continue;
      if (item.step === "orchestrator-sub") {
        const parentStage = "orchestrator";
        if (!orchByStage.has(parentStage)) orchByStage.set(parentStage, []);
        orchByStage.get(parentStage)!.push(item);
        continue;
      }
      const parentStage = THINKING_TO_STAGE[item.step];
      if (parentStage) {
        if (!thinkingByStage.has(parentStage)) thinkingByStage.set(parentStage, []);
        thinkingByStage.get(parentStage)!.push(item);
      } else {
        unmappedThinking.push(item);
      }
    }

    // Determine which stage gets tool calls (model/generate stage typically)
    const toolStage = processSteps.some((s) => s.stage === "model") ? "model"
      : processSteps.some((s) => s.stage === "generate") ? "generate" : null;

    // Build a map of existing steps by stage for quick lookup
    const existingStages = new Map<string, ProcessStep>();
    for (const step of processSteps) {
      existingStages.set(step.stage, step);
    }

    // Find where we are in the pipeline (last active/done stage index)
    const lastActiveIdx = Math.max(
      ...processSteps.map((s) => PIPELINE_STAGES.indexOf(s.stage)).filter((i) => i >= 0),
      -1,
    );

    // Build pipeline-step segments for ALL stages
    let segIdx = 0;
    for (let i = 0; i < PIPELINE_STAGES.length; i++) {
      const stageName = PIPELINE_STAGES[i];
      const existingStep = existingStages.get(stageName);

      if (existingStep) {
        // Real step from backend
        segments.push({
          type: "pipeline-step",
          step: existingStep,
          idx: segIdx++,
          thinkingChildren: thinkingByStage.get(stageName) || [],
          toolChildren: stageName === toolStage ? toolCalls : [],
          orchChildren: orchByStage.get(stageName) || [],
        });
      } else if (showAllStages && i > lastActiveIdx) {
        // Pending placeholder step (upcoming, not yet started)
        const friendly = STAGE_FRIENDLY[stageName] || { icon: "⚙️", label: stageName };
        const pendingStep: ProcessStep = {
          message: friendly.label,
          stage: stageName,
          status: "pending",
          startedAt: 0,
        };
        segments.push({
          type: "pipeline-step",
          step: pendingStep,
          idx: segIdx++,
          thinkingChildren: [],
          toolChildren: [],
          orchChildren: [],
        });
      }
    }

    // Append unmapped thinking items
    for (let i = 0; i < unmappedThinking.length; i++) {
      segments.push({ type: "thinking", item: unmappedThinking[i], idx: processSteps.length + i });
    }

    // Append tool calls not nested under any stage
    if (!toolStage && toolCalls.length > 0) {
      segments.push({ type: "tool-calls", toolCalls });
    }

    // Wrap consecutive parallel stages into parallel-group segments
    return _wrapParallelGroups(segments, existingStages);
  }

  // No pipeline steps — pure thinking item mode (shouldn't normally happen)
  let orchBuf: ThinkingItem[] = [];
  let idx = 0;
  let toolCallsInserted = false;

  for (const item of thinkingItems) {
    if (!item.step) continue;
    if (item.step === "orchestrator-sub") {
      orchBuf.push(item);
      continue;
    }
    if (orchBuf.length > 0) {
      segments.push({ type: "orchestrator-card", items: orchBuf });
      orchBuf = [];
    }
    segments.push({ type: "thinking", item, idx });
    idx++;
    if (!toolCallsInserted && toolCalls.length > 0 && (item.step === "reasoning" || item.step === "strategy")) {
      segments.push({ type: "tool-calls", toolCalls });
      toolCallsInserted = true;
    }
  }
  if (orchBuf.length > 0) {
    segments.push({ type: "orchestrator-card", items: orchBuf });
  }
  if (!toolCallsInserted && toolCalls.length > 0) {
    segments.push({ type: "tool-calls", toolCalls });
  }

  return segments;
}

/**
 * Wrap consecutive pipeline-step segments that belong to a PARALLEL_GROUP
 * into a single parallel-group segment. Groups whenever 2+ members of
 * a defined parallel group appear consecutively (any status, including pending).
 */
function _wrapParallelGroups(
  segments: FeedSegment[],
  _existingStages: Map<string, ProcessStep>,
): FeedSegment[] {
  if (PARALLEL_GROUPS.length === 0) return segments;

  const result: FeedSegment[] = [];

  // Build a set of stage names that belong to any parallel group
  const parallelStageSet = new Map<string, { stages: string[]; label: string }>();
  for (const pg of PARALLEL_GROUPS) {
    for (const s of pg.stages) parallelStageSet.set(s, pg);
  }

  let i = 0;
  while (i < segments.length) {
    const seg = segments[i];
    if (seg.type !== "pipeline-step" || !parallelStageSet.has(seg.step.stage)) {
      result.push(seg);
      i++;
      continue;
    }

    // Found a parallel-group stage — collect consecutive members of the same group
    const group = parallelStageSet.get(seg.step.stage)!;
    const groupStageSet = new Set(group.stages);
    const collected: FeedSegment[] = [seg];
    let j = i + 1;
    while (j < segments.length) {
      const next = segments[j];
      if (next.type === "pipeline-step" && groupStageSet.has(next.step.stage)) {
        collected.push(next);
        j++;
      } else {
        break;
      }
    }

    // Always wrap when 2+ parallel stages are consecutive (even if all pending)
    if (collected.length >= 2) {
      result.push({ type: "parallel-group", label: group.label, stages: collected });
    } else {
      result.push(...collected);
    }
    i = j;
  }

  return result;
}
