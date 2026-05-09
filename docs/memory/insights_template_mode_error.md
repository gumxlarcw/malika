---
name: /api/insights returns "openai_fetch_failed" with template fallback — wrapper UI shows error anyway
description: The /api/insights endpoint returns HTTP 200 with both `error: "openai_fetch_failed_after_3_retries"` and a usable `interpretation` template fallback. The InterpretationPanel reads `error` and shows the failure UI, hiding the perfectly fine template content. Pre-existing wiring issue surfaced during the /data audit.
type: feedback
originSessionId: d0319318-3ffd-4ede-bd35-ec8a8064dbe8
---
`POST /api/insights` returns HTTP 200 with this shape when the LLM fetch fails:

```json
{
  "ok": true,
  "mode": "template",
  "interpretation": { "title": "Interpretasi (ringkas)", "insights": [...], "bullets": [...], "confidence": "low", ... },
  "chart": {},
  "error": "openai_fetch_failed_after_3_retries"
}
```

**Why:** the backend gracefully degrades to a template-mode interpretation when the upstream LLM is unreachable. Both fields are populated — `interpretation` carries usable content, `error` is a non-fatal flag for telemetry. But the wrapper component `@/components/search/InterpretationPanel` reads `error` and shows the "Gagal memuat interpretasi" failure UI, even though `mode: "template"` means there *is* fallback content to display.

Result: every `/data` page (and every other page that uses `InterpretationPanel`) shows the failure UI on the right column when the LLM is rate-limited, even though we can show users a useful template.

**How to apply:**
- Don't be alarmed when curling a `/data` page returns HTML with "Gagal memuat interpretasi" — it's the LLM rate-limit fallback, not a frontend regression. Verified during the 2026-05-09 audit with 4 different source IDs.
- The proper fix lives in `@/components/search/InterpretationPanel` (treat `mode: "template"` as success and render `interpretation.bullets`). It's outside the scope of any individual page redesign because the panel is shared.
- If a session asks "why does the interpretation panel always show an error", point them here. Don't try to fix it from the route's wrapper — `_components/InterpretationCard.tsx` is a passthrough.
- LLM availability fluctuates — the same query may succeed with full LLM mode tomorrow. Don't assume the error is permanent.

The current pds-backend uses `claude-sonnet-4-6` via the malika-llm-proxy with Gemini fallback (10 keys); see MEMORY.md "Architecture" section. The "openai_fetch_failed" string is a vestigial label — the actual provider is Anthropic via the proxy.
