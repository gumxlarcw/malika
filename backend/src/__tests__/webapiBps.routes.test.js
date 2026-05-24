jest.mock('axios');
jest.mock('../models/WebapiHealthLog.model', () => {
  const M = jest.fn();
  M.create = jest.fn().mockResolvedValue({});
  M.findOne = jest.fn().mockResolvedValue(null);
  M.findAll = jest.fn().mockResolvedValue([]);
  M.findAndCountAll = jest.fn().mockResolvedValue({ count: 0, rows: [] });
  return M;
});
jest.mock('../services/pressrelease/apiKey.service', () => ({
  resolveBpsApiKey: jest.fn().mockResolvedValue('TEST_KEY'),
}));
jest.mock('../services/webapiBpsHealth/probe.service', () => ({
  runProbe: jest.fn().mockResolvedValue({
    runId: 'abc',
    overall: 'UP',
    durationMs: 100,
    perFamily: [
      { family: 'domain', ok: 1, latencyMs: 100, httpStatus: 200, errorCode: null },
    ],
  }),
}));
jest.mock('../config/db', () => ({
  query: jest.fn().mockResolvedValue([[{ uptime: 1, total: 4, failed: 0, p50: 100, p95: 200 }]]),
}));

const express = require('express');
const request = require('supertest');
const WebapiHealthLog = require('../models/WebapiHealthLog.model');
const webapiBpsRouter = require('../routes/webapiBps.routes');

function app() {
  const a = express();
  a.use(express.json());
  // No auth — test the router in isolation
  a.use('/webapi-bps', webapiBpsRouter);
  return a;
}

describe('webapiBps routes', () => {
  test('GET /webapi-bps/status returns snapshot', async () => {
    const r = await request(app()).get('/webapi-bps/status');
    expect(r.status).toBe(200);
    expect(r.body.overall).toBeDefined();
    expect(r.body.perFamily).toBeDefined();
    expect(r.body.circuit).toBeDefined();
    expect(r.body.apiKeyPresent).toBe(true);
  });

  test('GET /webapi-bps/history returns bucketed data', async () => {
    const sequelize = require('../config/db');
    sequelize.query.mockResolvedValueOnce([[
      { bucket_start: '2026-05-23 04:00:00', probes: 4, failed: 0, p95: 290 },
      { bucket_start: '2026-05-23 05:00:00', probes: 4, failed: 1, p95: 1820 },
    ]]);
    const r = await request(app()).get('/webapi-bps/history?hours=24&bucket=1h');
    expect(r.status).toBe(200);
    expect(r.body.bucket).toBe('1h');
    expect(r.body.buckets).toHaveLength(2);
    expect(r.body.buckets[0]).toMatchObject({ probes: 4, failed: 0 });
  });

  test('GET /webapi-bps/history rejects bucket=5m hours>24', async () => {
    const r = await request(app()).get('/webapi-bps/history?hours=168&bucket=5m');
    expect(r.status).toBe(400);
  });

  test('GET /webapi-bps/logs returns paginated logs', async () => {
    WebapiHealthLog.findAndCountAll.mockResolvedValueOnce({
      count: 2,
      rows: [
        { id: 2, run_id: 'r2', probe_kind: 'scheduled', endpoint_family: 'th',
          url_template: 'list/model/th/.../key/<REDACTED>/', http_status: null,
          latency_ms: null, ok: 0, error_code: 'TIMEOUT', error_message: 'timeout',
          bytes_received: null, created_at: '2026-05-24T03:45:18Z' },
        { id: 1, run_id: 'r1', probe_kind: 'scheduled', endpoint_family: 'domain',
          url_template: 'list/model/domain/.../key/<REDACTED>/', http_status: 200,
          latency_ms: 312, ok: 1, error_code: null, error_message: null,
          bytes_received: 1024, created_at: '2026-05-24T03:45:17Z' },
      ],
    });
    const r = await request(app()).get('/webapi-bps/logs?limit=50&offset=0');
    expect(r.status).toBe(200);
    expect(r.body.total).toBe(2);
    expect(r.body.logs).toHaveLength(2);
    expect(r.body.logs[0].endpoint_family).toBe('th');
  });

  test('GET /webapi-bps/logs respects status=error filter', async () => {
    WebapiHealthLog.findAndCountAll.mockResolvedValueOnce({ count: 0, rows: [] });
    const r = await request(app()).get('/webapi-bps/logs?status=error');
    expect(r.status).toBe(200);
    expect(WebapiHealthLog.findAndCountAll).toHaveBeenCalled();
    const args = WebapiHealthLog.findAndCountAll.mock.calls.at(-1)[0];
    expect(args.where.ok).toBe(0);
  });
});
