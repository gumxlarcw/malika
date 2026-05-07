/**
 * DnaCache Model
 *
 * Persistent MySQL cache for BPS DNA Nucleus API responses.
 * Stores structured/mapped metadata from MSVAR, MSIND, and MSKEG endpoints.
 *
 * Instead of calling the DNA API every time (slow: 5-17s per endpoint),
 * results are stored in this table and searched locally via SQL.
 *
 * BPS source detection:
 *  - MSVAR/MSIND: produsen_data_name contains "Direktorat" → BPS official
 *  - MSKEG: jenis_statistik === "STATISTIK_DASAR" → BPS official
 *  - Non-BPS items are still stored but flagged is_bps = false
 */

'use strict';

const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const DnaCache = sequelize.define('DnaCache', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },

  // ── Type / Source ────────────────────────────────────────
  endpoint: {
    type: DataTypes.ENUM('msvar', 'msind', 'mskeg'),
    allowNull: false,
    comment: 'DNA API endpoint type',
  },
  search_term: {
    type: DataTypes.STRING(255),
    allowNull: false,
    comment: 'Original search term (lowercased)',
  },
  dna_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    comment: 'Original DNA API item ID (for dedup)',
  },

  // ── Common fields ───────────────────────────────────────
  nama: {
    type: DataTypes.STRING(500),
    allowNull: true,
    comment: 'Variable/indicator name (MSVAR/MSIND) or kegiatan title (MSKEG)',
  },
  alias: {
    type: DataTypes.STRING(100),
    allowNull: true,
    comment: 'Short alias/abbreviation (MSVAR only)',
  },
  definisi: {
    type: DataTypes.TEXT,
    allowNull: true,
    comment: 'Official definition',
  },
  konsep: {
    type: DataTypes.TEXT,
    allowNull: true,
    comment: 'Conceptual framework (MSVAR/MSIND)',
  },
  satuan: {
    type: DataTypes.STRING(100),
    allowNull: true,
    comment: 'Unit of measurement',
  },
  ukuran: {
    type: DataTypes.STRING(100),
    allowNull: true,
    comment: 'Measurement type',
  },

  // ── MSVAR-specific ──────────────────────────────────────
  referensi_waktu: {
    type: DataTypes.STRING(255),
    allowNull: true,
    comment: 'Time reference (MSVAR)',
  },

  // ── MSIND-specific ──────────────────────────────────────
  variabel_pembangun: {
    type: DataTypes.TEXT,
    allowNull: true,
    comment: 'JSON string of building variables with kegiatan_penghasil (MSIND)',
  },

  // ── MSKEG-specific ──────────────────────────────────────
  tujuan: {
    type: DataTypes.TEXT,
    allowNull: true,
    comment: 'Purpose/objective (MSKEG)',
  },
  metode: {
    type: DataTypes.STRING(255),
    allowNull: true,
    comment: 'Data collection method (MSKEG)',
  },
  frekuensi: {
    type: DataTypes.STRING(255),
    allowNull: true,
    comment: 'Frequency (MSKEG)',
  },
  tahun: {
    type: DataTypes.STRING(10),
    allowNull: true,
    comment: 'Year of activity (MSKEG)',
  },

  // ── BPS source detection ────────────────────────────────
  jenis_statistik: {
    type: DataTypes.STRING(100),
    allowNull: true,
    comment: 'STATISTIK_DASAR / STATISTIK_SEKTORAL / STATISTIK_KHUSUS (MSKEG)',
  },
  produsen_data_name: {
    type: DataTypes.STRING(500),
    allowNull: true,
    comment: 'Data producer name (MSVAR/MSIND: check for "Direktorat")',
  },
  produsen_province_code: {
    type: DataTypes.STRING(10),
    allowNull: true,
    comment: 'Producer province code',
  },
  produsen_city_code: {
    type: DataTypes.STRING(10),
    allowNull: true,
    comment: 'Producer city code',
  },
  is_bps: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
    comment: 'true if produced by BPS (Direktorat for MSVAR/MSIND, STATISTIK_DASAR for MSKEG)',
  },

  // ── Timestamps ──────────────────────────────────────────
  fetched_at: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW,
    comment: 'When this record was fetched from DNA API',
  },
}, {
  tableName: 'dna_cache',
  timestamps: true,
  indexes: [
    // Fast lookup by search term + endpoint
    { fields: ['search_term', 'endpoint'] },
    // Dedup by DNA API ID + endpoint
    { unique: true, fields: ['dna_id', 'endpoint'], where: { dna_id: { [require('sequelize').Op.ne]: null } } },
    // Filter BPS-only results
    { fields: ['is_bps'] },
    // Full-text search on nama
    { type: 'FULLTEXT', fields: ['nama'] },
  ],
});

module.exports = DnaCache;
