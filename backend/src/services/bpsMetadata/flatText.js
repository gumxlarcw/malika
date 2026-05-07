'use strict';

const { stripHtml } = require('./htmlUtils');

/**
 * Build a "flat text" search corpus for an indicator. This is the text that
 * gets embedded into the search vector and indexed by FULLTEXT for keyword
 * search. Concatenates every meaningful field with separators so the embedding
 * model picks up signals from title, definition, methodology, and metric labels.
 */
function buildIndicatorFlatText(meta, metrics = []) {
  const parts = [];
  push(parts, meta?.title_clean);
  push(parts, meta?.subject_label);
  push(parts, meta?.bab);
  push(parts, meta?.mms_subject);
  push(parts, meta?.unit_id);
  push(parts, stripHtml(meta?.definition));
  push(parts, stripHtml(meta?.utility));
  push(parts, stripHtml(meta?.notes));
  push(parts, stripHtml(meta?.interpretation));
  push(parts, stripHtml(meta?.responsible_party));
  push(parts, stripHtml(meta?.source_citation_html));

  // Metric labels + units add powerful query signal: a user asking
  // "indikator dengan kolom hutan lindung" should match an interop indicator
  // whose metrics include a "Hutan Lindung" entry.
  for (const m of metrics) {
    push(parts, m?.metric_label_id);
    push(parts, m?.metric_label_en);
    push(parts, m?.unit_id);
    push(parts, stripHtml(m?.definition));
  }

  return parts.join(' · ');
}

function buildMetricFlatText(meta, metric) {
  const parts = [];
  push(parts, meta?.title_clean);                      // include parent indicator title
  push(parts, metric?.metric_label_id);
  push(parts, metric?.metric_label_en);
  push(parts, metric?.unit_id);
  push(parts, stripHtml(metric?.definition));
  push(parts, stripHtml(metric?.utility));
  push(parts, stripHtml(metric?.notes));
  push(parts, stripHtml(metric?.interpretation));
  return parts.join(' · ');
}

function push(parts, val) {
  if (val == null) return;
  const s = String(val).trim();
  if (s) parts.push(s);
}

module.exports = { buildIndicatorFlatText, buildMetricFlatText };
