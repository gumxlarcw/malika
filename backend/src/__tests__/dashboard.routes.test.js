'use strict';

jest.mock('../services/dashboard/dashboard.service', () => ({
  getSummary: jest.fn(),
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
