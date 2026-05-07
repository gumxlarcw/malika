'use strict';

const http = require('http');
const https = require('https');

function pickTransport(urlStr) {
  return urlStr.startsWith('https:') ? https : http;
}

function request(method, urlStr, { body = null, headers = {}, timeoutMs = 120000 } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const transport = pickTransport(urlStr);
    const opts = {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      method,
      timeout: timeoutMs,
      headers: {
        ...(body != null ? { 'Content-Type': 'application/json' } : {}),
        ...headers,
      },
    };
    const start = Date.now();
    const req = transport.request(opts, (res) => {
      res.on('error', reject);
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        const latencyMs = Date.now() - start;
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data), latencyMs });
        } catch {
          resolve({ status: res.statusCode, data: { raw: data }, latencyMs });
        }
      });
    });
    req.on('timeout', () => req.destroy(new Error(`Request timeout after ${timeoutMs}ms`)));
    req.on('error', reject);
    if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

function httpGetJson(urlStr, timeoutMs = 30000, extraHeaders = {}) {
  return request('GET', urlStr, { timeoutMs, headers: extraHeaders });
}

function httpPostJson(urlStr, body, timeoutMs = 120000, extraHeaders = {}) {
  return request('POST', urlStr, { body, timeoutMs, headers: extraHeaders });
}

module.exports = { httpGetJson, httpPostJson, request };
