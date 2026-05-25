'use strict';

// Single source of truth for BPS WebAPI request settings.
// Headers profile a real Firefox session — needed to traverse Cloudflare WAF
// in front of webapi.bps.go.id. Update here only; all callers import this.
const BPS_HEADERS = Object.freeze({
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
});

const BPS_TIMEOUT_MS = 20000;

module.exports = { BPS_HEADERS, BPS_TIMEOUT_MS };
