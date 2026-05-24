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
});
