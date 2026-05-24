'use strict';

// 4 endpoint sentinel WebAPI BPS yang di-probe tiap 15 menit.
// Spec: docs/superpowers/specs/2026-05-24-webapi-bps-status-design.md §5.1
//
// WISNU: STABLE_VAR_ID di bawah perlu diisi nilai nyata sebelum smoke test.
// Pilih variabel di domain 8200 (BPS Malut) yang Anda yakin sudah ada sejak
// tahun lama dan tidak akan dihapus. Contoh kandidat: '13' (Penduduk).
// Salah pilih = probe 'th' false-positive setiap 15 menit.

const DEFAULT_DOMAIN_ID = '8200';   // BPS Maluku Utara
const STABLE_VAR_ID     = '13';     // TODO(Wisnu): konfirmasi nilai stabil
                                     // Default '13' (Penduduk) — common, tapi validasi dulu

function buildTargets(apiKey) {
  return [
    {
      family: 'domain',
      url: `https://webapi.bps.go.id/v1/api/list/model/domain/lang/ind/key/${apiKey}/`,
      urlTemplate: 'list/model/domain/lang/ind/key/<REDACTED>/',
    },
    {
      family: 'var',
      url: `https://webapi.bps.go.id/v1/api/list/model/var/lang/ind/domain/${DEFAULT_DOMAIN_ID}/key/${apiKey}/page/1`,
      urlTemplate: `list/model/var/lang/ind/domain/${DEFAULT_DOMAIN_ID}/key/<REDACTED>/page/1`,
    },
    {
      family: 'th',
      url: `https://webapi.bps.go.id/v1/api/list/model/th/lang/ind/domain/${DEFAULT_DOMAIN_ID}/var/${STABLE_VAR_ID}/key/${apiKey}/`,
      urlTemplate: `list/model/th/lang/ind/domain/${DEFAULT_DOMAIN_ID}/var/${STABLE_VAR_ID}/key/<REDACTED>/`,
    },
    {
      family: 'pressrelease',
      url: `https://webapi.bps.go.id/v1/api/list/model/pressrelease/lang/ind/domain/${DEFAULT_DOMAIN_ID}/key/${apiKey}/page/1`,
      urlTemplate: `list/model/pressrelease/lang/ind/domain/${DEFAULT_DOMAIN_ID}/key/<REDACTED>/page/1`,
    },
  ];
}

// Headers identik dengan datasource/fetch.service.js — penting untuk WAF
const PROBE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/117.0',
  'Accept': 'application/json,text/html,*/*',
  'Accept-Language': 'en-US,en;q=0.9,id;q=0.8',
  'Accept-Encoding': 'gzip, deflate, br',
  'Referer': 'https://www.bps.go.id/',
  'Origin': 'https://www.bps.go.id',
  'Cache-Control': 'no-cache',
  'Pragma': 'no-cache',
  'DNT': '1',
  'Connection': 'keep-alive',
};

const PROBE_TIMEOUT_MS = 8000;

module.exports = {
  buildTargets,
  PROBE_HEADERS,
  PROBE_TIMEOUT_MS,
  DEFAULT_DOMAIN_ID,
  STABLE_VAR_ID,
};
