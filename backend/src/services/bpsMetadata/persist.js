'use strict';

const sequelize = require('../../config/db');
const { QueryTypes } = require('sequelize');
const { buildIndicatorFlatText, buildMetricFlatText } = require('./flatText');

/**
 * Persists extracted metadata to the new tables.
 *  - indicator_meta:     UPSERT one row per source_id
 *  - indicator_metric_meta: REPLACE all rows for that source_id
 *  - indicator_static_table: UPSERT one row (only when staticTable is provided)
 *
 * Idempotent. Safe to re-run.
 */
async function persistMetadata({ meta, metrics = [], staticTable }) {
  if (!meta || !meta.source_id) throw new Error('persistMetadata: missing meta.source_id');

  // Build flat_text from what we have so semantic search is ready out of the gate.
  const indicatorFlatText = buildIndicatorFlatText(meta, metrics);

  await sequelize.transaction(async (t) => {
    // ─── indicator_meta UPSERT ───────────────────────────────────────────────
    const replacements = {
      source_id: meta.source_id,
      source_type: meta.source_type,
      title_id_html: meta.title_id_html,
      title_en_html: meta.title_en_html,
      title_clean: meta.title_clean,
      subject_id: meta.subject_id,
      subject_label: meta.subject_label,
      bab: meta.bab,
      mms_subject: meta.mms_subject,
      unit_id: meta.unit_id,
      unit_en: meta.unit_en,
      decimal_places: meta.decimal_places,
      definition: meta.definition,
      utility: meta.utility,
      notes: meta.notes,
      interpretation: meta.interpretation,
      formula_html: meta.formula_html,
      formula_components: jsonOrNull(meta.formula_components),
      responsible_party: meta.responsible_party,
      source_citation_html: meta.source_citation_html,
      produced_by: jsonOrNull(meta.produced_by),
      data_legend: jsonOrNull(meta.data_legend),
      bps_table_id: meta.bps_table_id,
      bps_var_id: meta.bps_var_id,
      cutoff_date: meta.cutoff_date,
      bps_last_update: meta.bps_last_update,
      fetched_at: meta.fetched_at,
      raw_metadata: jsonOrNull(meta.raw_metadata),
      flat_text: indicatorFlatText,
    };

    await sequelize.query(
      `INSERT INTO indicator_meta
        (source_id, source_type, title_id_html, title_en_html, title_clean,
         subject_id, subject_label, bab, mms_subject,
         unit_id, unit_en, decimal_places,
         definition, utility, notes, interpretation, formula_html, formula_components,
         responsible_party, source_citation_html, produced_by,
         data_legend, bps_table_id, bps_var_id, cutoff_date, bps_last_update,
         fetched_at, raw_metadata, flat_text)
       VALUES
        (:source_id, :source_type, :title_id_html, :title_en_html, :title_clean,
         :subject_id, :subject_label, :bab, :mms_subject,
         :unit_id, :unit_en, :decimal_places,
         :definition, :utility, :notes, :interpretation, :formula_html, :formula_components,
         :responsible_party, :source_citation_html, :produced_by,
         :data_legend, :bps_table_id, :bps_var_id, :cutoff_date, :bps_last_update,
         :fetched_at, :raw_metadata, :flat_text)
       ON DUPLICATE KEY UPDATE
         source_type = VALUES(source_type),
         title_id_html = VALUES(title_id_html),
         title_en_html = VALUES(title_en_html),
         title_clean = VALUES(title_clean),
         subject_id = VALUES(subject_id),
         subject_label = VALUES(subject_label),
         bab = VALUES(bab),
         mms_subject = VALUES(mms_subject),
         unit_id = VALUES(unit_id),
         unit_en = VALUES(unit_en),
         decimal_places = VALUES(decimal_places),
         definition = VALUES(definition),
         utility = VALUES(utility),
         notes = VALUES(notes),
         interpretation = VALUES(interpretation),
         formula_html = VALUES(formula_html),
         formula_components = VALUES(formula_components),
         responsible_party = VALUES(responsible_party),
         source_citation_html = VALUES(source_citation_html),
         produced_by = VALUES(produced_by),
         data_legend = VALUES(data_legend),
         bps_table_id = VALUES(bps_table_id),
         bps_var_id = VALUES(bps_var_id),
         cutoff_date = VALUES(cutoff_date),
         bps_last_update = VALUES(bps_last_update),
         fetched_at = VALUES(fetched_at),
         raw_metadata = VALUES(raw_metadata),
         flat_text = VALUES(flat_text)`,
      { replacements, type: QueryTypes.INSERT, transaction: t },
    );

    // ─── indicator_metric_meta DELETE+INSERT ────────────────────────────────
    // Replace pattern: simpler than per-row UPSERT, idempotent, and reflects
    // the fact that BPS may rename or reorder columns between fetches.
    await sequelize.query(
      `DELETE FROM indicator_metric_meta WHERE source_id = :sid`,
      { replacements: { sid: meta.source_id }, type: QueryTypes.DELETE, transaction: t },
    );

    for (const m of metrics) {
      const flat = buildMetricFlatText(meta, m);
      await sequelize.query(
        `INSERT INTO indicator_metric_meta
          (source_id, metric_key, bps_column_id,
           metric_label_id, metric_label_en, metric_type,
           unit_id, unit_en, unit_multiplier, unit_multiplier_desc, decimal_places,
           definition, utility, notes, interpretation, formula_html, formula_components, cutoff_date,
           flat_text)
         VALUES
          (:source_id, :metric_key, :bps_column_id,
           :metric_label_id, :metric_label_en, :metric_type,
           :unit_id, :unit_en, :unit_multiplier, :unit_multiplier_desc, :decimal_places,
           :definition, :utility, :notes, :interpretation, :formula_html, :formula_components, :cutoff_date,
           :flat_text)`,
        {
          replacements: {
            source_id: meta.source_id,
            metric_key: m.metric_key,
            bps_column_id: m.bps_column_id,
            metric_label_id: m.metric_label_id,
            metric_label_en: m.metric_label_en,
            metric_type: m.metric_type,
            unit_id: m.unit_id,
            unit_en: m.unit_en,
            unit_multiplier: m.unit_multiplier,
            unit_multiplier_desc: m.unit_multiplier_desc,
            decimal_places: m.decimal_places,
            definition: m.definition,
            utility: m.utility,
            notes: m.notes,
            interpretation: m.interpretation,
            formula_html: m.formula_html,
            formula_components: jsonOrNull(m.formula_components),
            cutoff_date: m.cutoff_date,
            flat_text: flat,
          },
          type: QueryTypes.INSERT,
          transaction: t,
        },
      );
    }

    // ─── indicator_static_table UPSERT (static type only) ────────────────────
    if (staticTable) {
      await sequelize.query(
        `INSERT INTO indicator_static_table
          (source_id, table_html, table_parsed, excel_url, size_label, cr_date, updt_date, related, fetched_at)
         VALUES
          (:source_id, :table_html, :table_parsed, :excel_url, :size_label, :cr_date, :updt_date, :related, :fetched_at)
         ON DUPLICATE KEY UPDATE
           table_html = VALUES(table_html),
           table_parsed = VALUES(table_parsed),
           excel_url = VALUES(excel_url),
           size_label = VALUES(size_label),
           cr_date = VALUES(cr_date),
           updt_date = VALUES(updt_date),
           related = VALUES(related),
           fetched_at = VALUES(fetched_at)`,
        {
          replacements: {
            source_id: staticTable.source_id,
            table_html: staticTable.table_html,
            table_parsed: jsonOrNull(staticTable.table_parsed),
            excel_url: staticTable.excel_url,
            size_label: staticTable.size_label,
            cr_date: staticTable.cr_date,
            updt_date: staticTable.updt_date,
            related: jsonOrNull(staticTable.related),
            fetched_at: staticTable.fetched_at,
          },
          type: QueryTypes.INSERT,
          transaction: t,
        },
      );
    }

    // ─── data_sources tracking ───────────────────────────────────────────────
    await sequelize.query(
      `UPDATE data_sources
       SET bps_last_metadata_fetch = NOW(),
           bps_last_metadata_status = 'success'
       WHERE id = :sid`,
      { replacements: { sid: meta.source_id }, type: QueryTypes.UPDATE, transaction: t },
    );
  });
}

/** Mark a source as failed in data_sources tracking. Used when extraction errors out. */
async function markFetchFailure(sourceId, errorMessage) {
  await sequelize.query(
    `UPDATE data_sources
     SET bps_last_metadata_fetch = NOW(),
         bps_last_metadata_status = :status
     WHERE id = :sid`,
    {
      replacements: { sid: sourceId, status: `error: ${String(errorMessage || 'unknown').slice(0, 45)}` },
      type: QueryTypes.UPDATE,
    },
  );
}

function jsonOrNull(v) {
  if (v == null) return null;
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v);
  } catch {
    return null;
  }
}

module.exports = { persistMetadata, markFetchFailure };
