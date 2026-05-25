'use strict';

// 4 endpoint sentinel WebAPI BPS yang di-probe tiap 15 menit.
// Spec: docs/superpowers/specs/2026-05-24-webapi-bps-status-design.md §5.1
// Smoke test 2026-05-24: VAR_ID=13 (Penduduk) valid di domain 8200 (BPS Malut).

const { BPS_HEADERS } = require('../datasource/bpsHeaders');

const DEFAULT_DOMAIN_ID = '8200';   // BPS Maluku Utara
const STABLE_VAR_ID     = '13';     // Penduduk — verified stable

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

// Shared with datasource/fetch.service.js via bpsHeaders.js — single source of truth.
const PROBE_HEADERS = BPS_HEADERS;

const PROBE_TIMEOUT_MS = 8000;

module.exports = {
  buildTargets,
  PROBE_HEADERS,
  PROBE_TIMEOUT_MS,
  DEFAULT_DOMAIN_ID,
  STABLE_VAR_ID,
};
