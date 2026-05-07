/**
 * MALIKA Chat Components using @assistant-ui/react
 * 
 * These components replace @chatui/core with a more mobile-friendly
 * implementation that works better on iOS Safari.
 */


export {
  MalikaThread,
  MalikaMessages,
  MalikaUserMessage,
  MalikaAssistantMessage,
  MalikaSystemMessage,
  MalikaTypingIndicator,
  MalikaErrorBubble,
  MalikaQuickReplies,
  MalikaScrollToBottom,
} from "./AssistantThread";

// Extracted components for better modularity
export { KnowledgeModal } from "./KnowledgeModal";
export { SourcesSection } from "./SourcesSection";
export { MessageFeedback } from "./MessageFeedback";
export { DataSummaryBubble } from "./DataSummaryBubble";
export { CandidateSelector } from "./CandidateSelector";
export { KnowledgeCandidateSelector } from "./KnowledgeCandidateSelector";
export { ExternalSuggestionsSection } from "./ExternalSuggestionsSection";
export { default as DnaMetadataSection } from "./DnaMetadataSection";
export {
  SkeletonLine,
  ThreadSkeleton,
  MessageSkeleton,
  MessagesLoadingSkeleton,
} from "./ChatSkeletons";

// Extracted modal components (H5 refactor)
export { default as ChatShortcutsModal } from "./ChatShortcutsModal";
export { default as ChatExportModal } from "./ChatExportModal";
export { default as ChatRatingModal } from "./ChatRatingModal";
