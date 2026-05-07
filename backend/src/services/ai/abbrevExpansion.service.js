const Ajv2020 = require('ajv/dist/2020');
const { openAiChatJson } = require('./openaiChat.service');

function normalizeText(input) {
  return String(input || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function safeJsonParse(text) {
  const raw = String(text || '').trim();
  if (!raw) return { ok: false, value: null };

  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch {
    // continue
  }

  const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenceMatch && fenceMatch[1]) {
    const inner = String(fenceMatch[1]).trim();
    try {
      return { ok: true, value: JSON.parse(inner) };
    } catch {
      // continue
    }
  }

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

const LOCAL_ABBREV = new Map([
  ['pdrb', ['produk domestik regional bruto']],
  ['pdb', ['produk domestik bruto']],
  ['ipm', ['indeks pembangunan manusia']],
  ['tpt', ['tingkat pengangguran terbuka']],
  ['tpak', ['tingkat partisipasi angkatan kerja']],
  ['tpk', ['tingkat penghunian kamar']],
  ['ntp', ['nilai tukar petani']],
  ['ntn', ['nilai tukar nelayan']],
  ['umk', ['upah minimum kabupaten', 'upah minimum kota']],
  ['ump', ['upah minimum provinsi']],
  ['ihk', ['indeks harga konsumen']],
  ['pmtb', ['pembentukan modal tetap bruto']],
  ['pdrb adhb', ['pdrb atas dasar harga berlaku']],
  ['pdrb adhk', ['pdrb atas dasar harga konstan']],
]);

function expandLocal(q) {
  const norm = normalizeText(q);
  const terms = new Set();

  for (const [abbr, expansions] of LOCAL_ABBREV.entries()) {
    if (norm.includes(abbr)) {
      for (const e of expansions) terms.add(e);
    }
  }

  // Special casing: common punctuation forms
  if (/(\bp\.d\.r\.b\b|\bp\s*d\s*r\s*b\b)/i.test(String(q || ''))) {
    terms.add('produk domestik regional bruto');
  }

  return Array.from(terms);
}

function shouldTryOpenAi(q) {
  const raw = String(q || '').trim();
  if (!raw) return false;

  // Only attempt when there are obvious abbreviations.
  // - token of 2..6 uppercase letters (IPM, TPT, PDRB, NTP)
  // - or dotted abbreviation (P.D.R.B)
  if (/\b[A-Z]{2,6}\b/.test(raw)) return true;
  if (/\b(?:[A-Z]\.){2,6}\b/.test(raw)) return true;

  // Lowercase abbreviations we often see in search inputs.
  if (/\b(pdrb|ipm|tpt|tpak|ntp|ntn|umk|ump|ihk|pmtb)\b/.test(normalizeText(raw))) return true;

  return false;
}

const ajv = new Ajv2020({ allErrors: true, allowUnionTypes: true });
const schema = {
  type: 'object',
  additionalProperties: false,
  required: ['terms'],
  properties: {
    terms: {
      type: 'array',
      maxItems: 6,
      items: { type: 'string', minLength: 2, maxLength: 80 },
    },
  },
};
const validate = ajv.compile(schema);

async function expandWithOpenAi({ q }) {
  const modelPrimary = process.env.OPENAI_INTERPRETATION_MODEL || 'gpt-4.1-mini';
  const modelFallback = process.env.OPENAI_INTERPRETATION_MODEL_FALLBACK || 'gpt-4.1';

  const messages = [
    {
      role: 'system',
      content: [
        'You expand abbreviations in Indonesian statistical indicator queries.',
        'Return STRICT JSON only (no markdown, no extra keys).',
        'Output schema: { "terms": string[] }',
        'Rules:',
        '- Only include expansions for abbreviations present in the query.',
        '- Prefer Indonesian expansions.',
        '- Do NOT include datasource ids, URLs, or any database-only details.',
        '- If unsure, return {"terms": []}.',
      ].join('\n'),
    },
    { role: 'user', content: JSON.stringify({ q: String(q || '') }) },
  ];

  async function attempt(model) {
    const data = await openAiChatJson({
      apiKeyEnv: 'OPENAI_API_KEY_INTERPRETATION',
      model,
      messages,
      temperature: 0,
    });

    const content = data?.choices?.[0]?.message?.content;
    const parsed = safeJsonParse(String(content || ''));
    if (!parsed.ok) return null;
    if (!validate(parsed.value)) return null;
    return parsed.value;
  }

  try {
    return (await attempt(modelPrimary)) || (await attempt(modelFallback)) || { terms: [] };
  } catch {
    return { terms: [] };
  }
}

async function expandIndicatorAbbreviations({ q }) {
  const query = String(q || '').trim();
  if (!query) return { terms: [] };

  const local = expandLocal(query);
  if (local.length > 0) return { terms: local };

  if (!shouldTryOpenAi(query)) return { terms: [] };

  // Optional OpenAI enhancement (server-side only). If key missing, openaiChat.service throws.
  return await expandWithOpenAi({ q: query });
}

module.exports = {
  expandIndicatorAbbreviations,
  // exported for tests
  expandLocal,
  shouldTryOpenAi,
};
