// Feature flags read from NEXT_PUBLIC_* env vars at build time.
// InterpretationPanel triggers a chat-LLM call. Per spec C1 (no chat-LLM on PWA /search),
// SEARCH_INSIGHT_ENABLED defaults OFF. DATA_INSIGHT_ENABLED defaults ON (different surface).

export const SEARCH_INSIGHT_ENABLED =
  process.env.NEXT_PUBLIC_ENABLE_INSIGHT_ON_SEARCH === "1";

export const DATA_INSIGHT_ENABLED =
  process.env.NEXT_PUBLIC_ENABLE_INSIGHT_ON_DATA !== "0";
