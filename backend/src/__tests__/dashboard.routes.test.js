'use strict';

jest.mock('../services/dashboard/dashboard.service', () => ({
  getSummary: jest.fn(),
  getSeries: jest.fn(),
}));

const express = require('express');
const request = require('supertest');
const svc = require('../services/dashboard/dashboard.service');

function makeApp() {
  const app = express();
  app.use('/dashboard/public', require('../routes/dashboard.public.routes'));
  return app;
}

describe('GET /dashboard/public/summary', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns the summary payload', async () => {
    svc.getSummary.mockResolvedValue({
      headline: [{ sourceId: 1 }],
      categories: [{ name: 'Ekonomi', indicators: [{ sourceId: 1 }] }],
      generatedAt: '2026-08-17T00:00:00.000Z',
    });

    const res = await request(makeApp()).get('/dashboard/public/summary');

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.categories[0].name).toBe('Ekonomi');
  });

  test('returns 500 with a generic message when the service throws', async () => {
    svc.getSummary.mockRejectedValue(new Error('db exploded'));

    const res = await request(makeApp()).get('/dashboard/public/summary');

    expect(res.status).toBe(500);
    expect(res.body.ok).toBe(false);
    // Never leak internals to the client (see .claude/rules/api-conventions.md).
    expect(JSON.stringify(res.body)).not.toMatch(/db exploded/);
  });
});

describe('GET /dashboard/public/series', () => {
  beforeEach(() => jest.clearAllMocks());

  test('passes ids and limit through to the service', async () => {
    svc.getSeries.mockResolvedValue({ series: [{ sourceId: 1, points: [] }] });

    const res = await request(makeApp()).get('/dashboard/public/series?ids=1,164&limit=12');

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(svc.getSeries).toHaveBeenCalledWith('1,164', '12');
  });

  test('returns 400 for invalid input', async () => {
    svc.getSeries.mockRejectedValue(new Error('Invalid ids'));

    const res = await request(makeApp()).get('/dashboard/public/series?ids=abc');

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid ids');
  });

  test('returns 500 with a generic message when the service throws', async () => {
    svc.getSeries.mockRejectedValue(new Error('db exploded'));

    const res = await request(makeApp()).get('/dashboard/public/series?ids=1');

    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toMatch(/db exploded/);
  });
});
