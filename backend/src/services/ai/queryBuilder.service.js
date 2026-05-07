const { openAiChatJson, openAiToolCall } = require('./openaiChat.service');
const { validateQueryBuilderOutput } = require('./queryBuilder.validator');
const QUERY_BUILDER_SCHEMA = require('./queryBuilder.schema.json');
const vectorSearch = require('./vectorSearch.service');

function safeJsonParse(text) {
  const raw = String(text || '').trim();
  if (!raw) return { ok: false, value: null };

  // 1) Try direct parse
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch {
    // continue
  }

  // 2) If wrapped in a single markdown code fence, extract its body
  // Example:
  // ```json
  // { ... }
  // ```
  const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenceMatch && fenceMatch[1]) {
    const inner = String(fenceMatch[1]).trim();
    try {
      return { ok: true, value: JSON.parse(inner) };
    } catch {
      // continue
    }
  }

  // 3) Fallback: find the first JSON object substring
  const firstBrace = raw.indexOf('{');
  const lastBrace = raw.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    const candidate = raw.slice(firstBrace, lastBrace + 1);
    try {
      return { ok: true, value: JSON.parse(candidate) };
    } catch {
      // continue
    }
  }

  return { ok: false, value: null };
}

function normalizeText(input) {
  return String(input || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function extractDeterministicHints(q) {
  const norm = normalizeText(q);
  if (!norm) return { norm: '' };

  const years = Array.from(norm.matchAll(/\b(19\d{2}|20\d{2}|2100)\b/g))
    .map((m) => Number(m[1]))
    .filter((y) => Number.isInteger(y) && y >= 1900 && y <= 2999)
    .slice(0, 3);

  const monthMap = {
    januari: 1,
    februari: 2,
    maret: 3,
    april: 4,
    mei: 5,
    juni: 6,
    juli: 7,
    agustus: 8,
    september: 9,
    oktober: 10,
    november: 11,
    desember: 12,
  };
  let month = null;
  for (const [name, no] of Object.entries(monthMap)) {
    if (norm.includes(name)) {
      month = { name, no };
      break;
    }
  }

  const hasEkspor = /\b(ekspor|export)\b/.test(norm);
  const hasImpor = /\b(impor|import)\b/.test(norm);
  const directionHint = hasEkspor !== hasImpor ? (hasEkspor ? 'ekspor' : 'impor') : null;

  const isEximLike = /\b(ekspor|impor|hs2|hs|kode\s*hs|komoditas|pelabuhan|negara|perdagangan\s+l(uar\s+)?negeri)\b/.test(norm);
  const mentionsPod = /\b(pelabuhan|pod)\b/.test(norm);
  const mentionsCtr = /\b(negara|tujuan|ctr)\b/.test(norm);

  const wantsPressrelease = /\b(brs|berita\s+resmi\s+statistik|rilis|press\s*release)\b/.test(norm);
  const wantsPublication = /\b(publikasi|publication)\b/.test(norm);

  const wantsKabKota = /\b(kab(upaten)?\/?kota|kabupaten|kota|menurut\s+kabupaten|menurut\s+kab\/?kota)\b/.test(norm);
  const geoHints = [];
  if (norm.includes('maluku utara') || /\bmalut\b/.test(norm)) geoHints.push('maluku utara');

  const hasInflasi = /\binflasi\b/.test(norm);
  const hasIhk = /\bihk\b/.test(norm) || /\bindeks\s+harga\s+konsumen\b/.test(norm);

  return {
    norm,
    years,
    month,
    directionHint,
    isEximLike,
    mentionsPod,
    mentionsCtr,
    wantsPressrelease,
    wantsPublication,
    wantsKabKota,
    geoHints,
    hasInflasi,
    hasIhk,
  };
}

function buildSystemPrompt(candidatesContext = '') {
  const base = [
    'You are a query builder. Convert the user query into STRICT JSON only.',
    'Do not output any extra keys beyond the schema.',
    'If information is missing, use null for optional fields and set intent/type to unknown when unsure.',
    'When the user request has multiple constraints (time + dimension + geo + operation), also fill `clauses` to represent the multi-level structure.',
    '',
    'Input format:',
    '- You will receive a JSON object: { q: string, hints: object, context?: string, candidates?: string }.',
    '- `hints` is deterministic pre-parsing of the same query; treat it as reliable for time/direction cues.',
    '- `context` (if provided) is a summary/transcript of earlier chat messages. Use it ONLY to resolve references like "yang tadi" or omitted year/wilayah that were already stated earlier.',
    '- `candidates` (if provided) is a list of relevant datasources ranked by semantic similarity. Use it to pick the correct source_id.',
    '- Do NOT invent year/month/EXIM facets when they are absent from BOTH q and hints.',
    '',
    'Domain rules:',
    '- This app routes to: dynamic, interop, static, exim, pressrelease.',
    '- For EXIM:',
    '  - direction can be impor or ekspor (or null if not sure).',
    '  - month is 1..12 if present.',
    '  - group can only be "hs2" (or null). Use group=hs2 if query mentions "menurut komoditas" or "komoditas" (and no specific HS2 code).',
    '  - code_hs is HS2 (two digits) if user explicitly specifies HS2 code.',
    '  - metric is usually null unless user explicitly says value or netweight.',
    '- Guardrail: if year/period is missing, prefer intent=search (not deep-link data).',
    '- When candidates are provided, prefer selecting source_id from the top candidates if they match the query intent.',
  ];

  if (candidatesContext) {
    base.push('');
    base.push('CANDIDATE DATASOURCES (use these to select source_id):');
    base.push(candidatesContext);
  }

  return base.join('\n');
}

function formatSchemaErrors(errors) {
  const list = Array.isArray(errors) ? errors : [];
  return list
    .slice(0, 12)
    .map((e) => {
      const instancePath = e?.instancePath ? String(e.instancePath) : '';
      const message = e?.message ? String(e.message) : '';
      const keyword = e?.keyword ? String(e.keyword) : '';
      const params = e?.params ? JSON.stringify(e.params) : '';
      return { instancePath, keyword, message, params };
    });
}

const QUERY_BUILDER_TOOL_NAME = 'emit_query_builder_json_v1';

function getQueryBuilderToolParameters() {
  // Tool-call schema must be JSON Schema object (no $schema/$id).
  // Keep queryBuilder.schema.json as the single source of truth.
  const schema = QUERY_BUILDER_SCHEMA && typeof QUERY_BUILDER_SCHEMA === 'object' ? QUERY_BUILDER_SCHEMA : {};
  // eslint-disable-next-line no-unused-vars
  const { $schema, $id, title, ...rest } = schema;
  return rest;
}

const QUERY_BUILDER_TOOL_PARAMETERS = getQueryBuilderToolParameters();

function normalizeOutput(obj, q) {
  // Ensure params.q echoes original query.
  if (obj && typeof obj === 'object') {
    obj.version = 1;
    obj.params = obj.params && typeof obj.params === 'object' ? obj.params : {};
    obj.params.q = String(obj.params.q || q || '').trim() || String(q || '').trim();

    // Guardrail: only set EXIM pod/ctr when user explicitly asks for it.
    // This prevents province names (e.g. "maluku utara") from being incorrectly mapped to pod/ctr.
    const nq = String(q || '').toLowerCase();
    const mentionsPod = /\b(pelabuhan|pod)\b/.test(nq);
    const mentionsCtr = /\b(negara|tujuan|ctr)\b/.test(nq);
    if (!mentionsPod) obj.params.pod = null;
    if (!mentionsCtr) obj.params.ctr = null;

    // Keep EXIM metric strict when set.
    const mRaw = String(obj.params.metric || '').toLowerCase().trim();
    const m =
      mRaw === 'value' || mRaw === 'nilai'
        ? 'value'
        : mRaw === 'netweight' || mRaw === 'volume' || mRaw === 'berat' || mRaw === 'netto' || mRaw === 'berat bersih'
          ? 'netweight'
          : '';
    obj.params.metric = m ? m : null;
  }
  return obj;
}

async function attemptBuild({ q, context = '', candidates = '', model, repair = false, previousInvalid = null, schemaErrors = null }) {
  const hints = extractDeterministicHints(q);
  const ctx = String(context || '').trim().slice(0, 6000);
  const cands = String(candidates || '').trim().slice(0, 2000);
  
  const messages = [
    { role: 'system', content: buildSystemPrompt(cands) },
    {
      role: 'user',
      content: JSON.stringify(
        repair
          ? {
              q,
              hints,
              context: ctx || undefined,
              candidates: cands || undefined,
              previous_invalid_output: previousInvalid,
              schema_errors: formatSchemaErrors(schemaErrors),
              instruction:
                'Return corrected STRICT JSON that VALIDATES against the schema. Do not add extra keys. Prefer setting unknowns to null/unknown rather than guessing.',
            }
          : { q, hints, context: ctx || undefined, candidates: cands || undefined }
      ),
    },
  ];

  // Prefer tool-calling for reliable structured output.
  let parsedValue = null;
  try {
    const toolResp = await openAiToolCall({
      apiKeyEnv: 'OPENAI_API_KEY_QUERY_BUILDER',
      model,
      messages,
      toolName: QUERY_BUILDER_TOOL_NAME,
      toolParameters: QUERY_BUILDER_TOOL_PARAMETERS,
      temperature: 0,
    });

    const argsText = toolResp?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    const argsParsed = safeJsonParse(String(argsText || ''));
    if (argsParsed.ok) parsedValue = argsParsed.value;
  } catch {
    // fall back to plain JSON response
  }

  if (!parsedValue) {
    const data = await openAiChatJson({
      apiKeyEnv: 'OPENAI_API_KEY_QUERY_BUILDER',
      model,
      messages,
      temperature: 0,
    });

    const content = data?.choices?.[0]?.message?.content;
    const parsed = safeJsonParse(String(content || ''));
    if (!parsed.ok) {
      return { ok: false, error: 'INVALID_JSON', raw: String(content || '').slice(0, 2000) };
    }
    parsedValue = parsed.value;
  }

  const normalized = normalizeOutput(parsedValue, q);
  const validation = validateQueryBuilderOutput(normalized);
  if (!validation.ok) {
    // One-shot self-repair: ask the model to correct its own output using schema errors.
    if (!repair) {
      const repaired = await attemptBuild({
        q,
        model,
        repair: true,
        previousInvalid: normalized,
        schemaErrors: validation.errors,
      });
      if (repaired.ok) return repaired;
    }

    return {
      ok: false,
      error: 'SCHEMA_INVALID',
      raw: normalized,
      schemaErrors: validation.errors,
    };
  }

  return { ok: true, value: normalized };
}

async function buildQueryFromText({ q, context = '', useVectorSearch = true }) {
  const query = String(q || '').trim();
  if (!query) {
    const err = new Error('Missing q');
    err.statusCode = 400;
    err.code = 'BAD_REQUEST';
    throw err;
  }

  // Get candidate datasources from vector search (if enabled and available)
  let candidates = '';
  if (useVectorSearch) {
    try {
      candidates = await vectorSearch.searchForQueryBuilder(query, 5);
    } catch (e) {
      // Vector search failed (e.g., no embeddings yet) - continue without candidates
      console.warn('[QueryBuilder] Vector search failed:', e.message);
    }
  }

  const modelPrimary = process.env.OPENAI_QUERY_BUILDER_MODEL || 'gpt-4.1-mini';
  const modelFallback = process.env.OPENAI_QUERY_BUILDER_MODEL_FALLBACK || 'gpt-4.1';

  const first = await attemptBuild({ q: query, context, candidates, model: modelPrimary });
  if (first.ok) return first.value;

  const second = await attemptBuild({ q: query, context, candidates, model: modelFallback });
  if (second.ok) return second.value;

  const err = new Error('Query builder failed to produce valid JSON');
  err.statusCode = 502;
  err.code = 'OPENAI_INVALID_OUTPUT';
  throw err;
}

module.exports = {
  buildQueryFromText,
  getQueryBuilderToolParameters,
};
