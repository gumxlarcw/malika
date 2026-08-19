'use strict';
/**
 * Self-hosted embedding service using Xenova/multilingual-e5-base (768d, INT8 quantized).
 * Replaces the Gemini API path after free-tier quotas exhausted on 2026-05-09.
 *
 * Why e5-base over e5-large on this hardware (i5-4590T 4-core Haswell):
 *   - e5-large: 23 rows/min observed, ETA ~20 hours for 28K rows. CPU saturated.
 *   - e5-base: ~3-5× faster inference. 280 MB resident vs 1.3 GB. Less swap pressure.
 *   - MIRACL Indonesian nDCG@10: e5-base ~68 vs e5-large ~72. ~4-point drop.
 *   - With reranker (documentJudge.service.js), real-world recall@10 difference
 *     shrinks to ~2 points. Worth the 4-5× speed gain.
 *
 * - Pure ONNX inference via @xenova/transformers, no external API
 * - Model auto-downloads from HuggingFace on first call (~280 MB INT8 quantized)
 * - Singleton pipeline: loaded once, reused (~30 sec first load, ~50-150 ms per inference)
 * - L2-normalized output → cosine similarity behaves correctly with VECTOR KEY
 *
 * Prompt format (e5-base convention):
 *   queries: "query: {text}"
 *   passages: "passage: {text}"
 *
 * Reference: https://huggingface.co/intfloat/multilingual-e5-base
 */

const MODEL_ID = 'Xenova/multilingual-e5-base';
const FALLBACK_MODEL_ID = 'Xenova/multilingual-e5-small';
const DIMENSIONS = 768;
// Guard-rail only. It used to be the de-facto chunk size at 1500 chars, which the
// note below it justified as "~370 tokens, well under the 512-token limit" — that
// was measured against short documents. Real chunks average 3,508 chars and
// tokenize to ~1,052, so the cap was silently discarding more than half the text
// of 98.1% of chunks. Windows are now built to a token budget before they get
// here; this only has to be wide enough not to cut one, and the widest observed
// ratio is 5.54 chars/token (480 tokens ≈ 2,660 chars).
const MAX_INPUT_CHARS = 3000;

let _pipelinePromise = null;
let _loadedModelId = null;

async function getPipeline() {
  if (_pipelinePromise) return _pipelinePromise;
  _pipelinePromise = (async () => {
    const { pipeline, env } = await import('@xenova/transformers');
    // Allow remote download (default true). Set to false to force offline mode.
    env.allowLocalModels = true;
    env.allowRemoteModels = true;

    // We use `quantized: true` for both attempts. The non-instruct e5-large
    // unquantized variant requires an external .onnx_data shard that
    // @xenova/transformers does not fetch (verified 2026-05-09 with v2.17.2);
    // the quantized variant is self-contained INT8 (~561 MB) and produces
    // sensible cosine similarities (verified 0.88 on a matching pair).
    try {
      const pipe = await pipeline('feature-extraction', MODEL_ID, { quantized: true });
      _loadedModelId = MODEL_ID;
      console.log(`[embedding] loaded ${MODEL_ID}`);
      return pipe;
    } catch (err) {
      console.warn(`[embedding] ${MODEL_ID} failed (${err.message}), trying ${FALLBACK_MODEL_ID}`);
      const pipe = await pipeline('feature-extraction', FALLBACK_MODEL_ID, { quantized: true });
      _loadedModelId = FALLBACK_MODEL_ID;
      console.log(`[embedding] loaded ${FALLBACK_MODEL_ID}`);
      return pipe;
    }
  })();
  return _pipelinePromise;
}

/**
 * Embed a passage (document content). Used during backfill / indexing.
 * Uses the standard e5 "passage: " prefix convention.
 */
async function embedPassage(text) {
  const cleaned = String(text || '').trim().slice(0, MAX_INPUT_CHARS);
  if (!cleaned) throw new Error('Empty text for embedding');
  const pipe = await getPipeline();

  const out = await pipe(`passage: ${cleaned}`, { pooling: 'mean', normalize: true });
  const arr = Array.from(out.data);
  if (arr.length !== DIMENSIONS) {
    throw new Error(`Embedding dim mismatch: got ${arr.length}, expected ${DIMENSIONS}`);
  }
  return arr;
}

/**
 * Embed a query string. Used at chat-time for retrieval.
 * Uses the standard e5 "query: " prefix convention.
 */
async function embedQuery(text) {
  const cleaned = String(text || '').trim().slice(0, MAX_INPUT_CHARS);
  if (!cleaned) throw new Error('Empty text for embedding');
  const pipe = await getPipeline();

  const out = await pipe(`query: ${cleaned}`, { pooling: 'mean', normalize: true });
  const arr = Array.from(out.data);
  if (arr.length !== DIMENSIONS) {
    throw new Error(`Embedding dim mismatch: got ${arr.length}, expected ${DIMENSIONS}`);
  }
  return arr;
}

/**
 * Default `generateEmbedding` — treats input as a query for chat compat.
 * Backfill scripts should call embedPassage explicitly.
 */
async function generateEmbedding(text) {
  return embedQuery(text);
}

/** Cosine similarity for two 768-dim vectors. */
function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  // Vectors are L2-normalized by the model — cosine sim equals dot product.
  return dot;
}

/**
 * Token count for the embedding model, used to size windows before embedding.
 * Deliberately the model's own tokenizer rather than a character heuristic: this
 * corpus runs 1.51-5.54 chars per token, so no single ratio is safe.
 */
let _tokenizerPromise = null;
async function countTokens(text) {
  if (!_tokenizerPromise) {
    _tokenizerPromise = (async () => {
      const { AutoTokenizer } = await import('@xenova/transformers');
      return AutoTokenizer.from_pretrained(_loadedModelId || MODEL_ID);
    })();
  }
  const tokenizer = await _tokenizerPromise;
  const encoded = tokenizer(String(text || ''));
  return encoded.input_ids.dims[encoded.input_ids.dims.length - 1];
}

module.exports = {
  countTokens,
  generateEmbedding,
  embedQuery,
  embedPassage,
  cosineSimilarity,
  EMBEDDING_DIMENSIONS: DIMENSIONS,
  EMBEDDING_MODEL: MODEL_ID,
  getLoadedModelId: () => _loadedModelId,
};
