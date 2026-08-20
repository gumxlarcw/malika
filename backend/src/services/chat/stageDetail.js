'use strict';

/**
 * stageDetail — the `detail` line under each row of the nine-step rail.
 *
 * The rail proved *that* a stage ran; it never showed *what* the stage found,
 * because every status event carried only {message, stage}. `ProcessStepLike`
 * has had a `detail` field and `ProgressRail` a `<Detail>` renderer the whole
 * time — the data was simply never sent.
 *
 * These are pure formatters so they can be tested without standing up the
 * streaming path; streaming.service.js supplies the values it already has in
 * scope and does no formatting of its own.
 */

/** Indonesian thousands: 2.400 — not 2,400. */
const idInt = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');

/** A rail row is one line; a pasted paragraph would wreck it. */
const clip = (text, max) => (text.length <= max ? text : `${text.slice(0, max - 1)}…`);

/**
 * Per-stage timing measured from where a stage's WORK begins, which is not
 * where its status event fires. `dna` and `search` are emitted on adjacent
 * lines, and the knowledge search is kicked off ~1000 lines before it is
 * announced; deriving durations from the gaps between status events therefore
 * reported 0,0s for one and the wrong window for the other.
 *
 * `now` is injectable so the clock can be tested without real time passing.
 */
function createStageClock(now = Date.now) {
  const started = new Map();
  return {
    /** First mark wins — a re-announced stage must not restart its window. */
    mark(stage) {
      if (!started.has(stage)) started.set(stage, now());
    },
    elapsed(stage) {
      const t0 = started.get(stage);
      return t0 === undefined ? undefined : now() - t0;
    },
  };
}

/**
 * geoInference keys its table by lowercase name, so the `canonical` it returns
 * is lowercase ('halmahera barat'). Cased here rather than there: that service
 * depends on the lowercase form for alias lookup.
 */
const titleCase = (text) =>
  text.replace(/\S+/g, (w) => w.charAt(0).toUpperCase() + w.slice(1));

/** Default region when the question names none: the corpus is Maluku Utara. */
function formatNormalizeDetail({ geo, year } = {}) {
  const region = geo ? titleCase(String(geo).trim()) : 'Maluku Utara';
  const period = year ? String(year) : 'tahun terbaru';
  return `${region} · ${period}`;
}

/**
 * The candidate score is an unbounded additive relevance score, NOT a
 * similarity: streaming.service.js adds boosts of +100 (kab/kota + topic
 * match), +30 (topic only) and +20 on top of a base, and reads confidence off
 * fixed thresholds — >=80 high, 70-79 medium, <70 low. A live query returned
 * 112, so any attempt to render it as 0-1 produces a number off the scale.
 *
 * The raw figure is kept because the point of the rail is an audit trail; the
 * band is what makes it readable to someone who has not read the thresholds.
 */
const confidenceBand = (score) => {
  if (score >= 80) return 'tinggi';
  if (score >= 70) return 'sedang';
  return 'rendah';
};

function formatSearchDetail(candidates) {
  const list = Array.isArray(candidates) ? candidates : [];
  if (list.length === 0) return 'tidak ada kandidat cocok';

  const scores = list.map((c) => Number(c?.score)).filter((s) => Number.isFinite(s));
  if (scores.length === 0) return `${list.length} kandidat`;

  const top = Math.max(...scores);
  return `${list.length} kandidat · skor tertinggi ${idInt(top)} (${confidenceBand(top)})`;
}

function formatPreviewDetail(preview) {
  const rows = preview?.rows;
  if (!Array.isArray(rows) || rows.length === 0) return 'tanpa tabel';

  const columns = Array.isArray(preview.columns)
    ? preview.columns.length
    : Object.keys(rows[0] || {}).length;

  return `Tabel ${rows.length} baris × ${columns} kolom`;
}

function formatKnowledgeDetail(docs) {
  const list = Array.isArray(docs) ? docs : [];
  if (list.length === 0) return 'tanpa referensi';
  return `${list.length} dokumen referensi`;
}

/** Query shape after normalization — the DNA stage's own contribution. */
const DNA_MAX = 80;
function formatDnaDetail({ originalQuery, normalizedQuery, usedFastPath } = {}) {
  const query = String(normalizedQuery || originalQuery || '').trim();
  if (!query) return '';

  let prefix = '';
  if (usedFastPath) prefix = 'jalur cepat · ';
  else if (normalizedQuery && originalQuery && normalizedQuery !== originalQuery) {
    prefix = 'dinormalkan · ';
  }
  return prefix + clip(query, DNA_MAX - prefix.length);
}

function formatThinkingDetail({ tier, maxTokens } = {}) {
  const budget = `anggaran ${idInt(maxTokens || 0)} token`;
  return tier ? `tier ${tier} · ${budget}` : budget;
}

function formatDeepdiveDetail(reasoningText) {
  const len = String(reasoningText || '').length;
  return len === 0 ? 'tanpa jejak nalar' : `jejak nalar ${idInt(len)} karakter`;
}

function formatGeneratingDetail({ text, model } = {}) {
  const chars = `${idInt(String(text || '').length)} karakter`;
  return model ? `${chars} · ${model}` : chars;
}

/**
 * What the formatting stage actually produced. `table.rows` is the same shape
 * buildUIMetadata emits, so an answer with no table reports its suggestions
 * rather than an empty table.
 */
function formatFormatDetail(uiMeta) {
  const parts = [];

  const rows = uiMeta?.table?.rows;
  if (Array.isArray(rows) && rows.length > 0) {
    const columns = Array.isArray(uiMeta.table.columns)
      ? uiMeta.table.columns.length
      : Object.keys(rows[0] || {}).length;
    parts.push(`tabel ${rows.length}×${columns}`);
  }

  const suggestions = uiMeta?.suggestions;
  if (Array.isArray(suggestions) && suggestions.length > 0) {
    parts.push(`${suggestions.length} saran`);
  }

  return parts.length > 0 ? parts.join(' · ') : 'jawaban teks';
}

module.exports = {
  createStageClock,
  formatNormalizeDetail,
  formatSearchDetail,
  formatPreviewDetail,
  formatKnowledgeDetail,
  formatDnaDetail,
  formatThinkingDetail,
  formatDeepdiveDetail,
  formatGeneratingDetail,
  formatFormatDetail,
};
