'use strict';

const http = require('http');
const { httpGetJson, httpPostJson } = require('../lib/httpClient');

describe('httpGetJson', () => {
  let server;
  let port;

  beforeAll((done) => {
    server = http.createServer((req, res) => {
      if (req.url === '/ok') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ items: [1, 2, 3] }));
      } else if (req.url === '/bad') {
        res.writeHead(500);
        res.end('server error');
      } else if (req.url === '/notjson') {
        res.writeHead(200);
        res.end('hello world');
      }
    });
    server.listen(0, () => { port = server.address().port; done(); });
  });

  afterAll(() => new Promise((resolve) => server.close(resolve)));

  test('returns parsed JSON with status and latencyMs', async () => {
    const r = await httpGetJson(`http://127.0.0.1:${port}/ok`);
    expect(r.status).toBe(200);
    expect(r.data).toEqual({ items: [1, 2, 3] });
    expect(r.latencyMs).toBeGreaterThanOrEqual(0);
  });

  test('returns raw body when response is not JSON', async () => {
    const r = await httpGetJson(`http://127.0.0.1:${port}/notjson`);
    expect(r.status).toBe(200);
    expect(r.data).toEqual({ raw: 'hello world' });
  });

  test('returns status code on non-2xx', async () => {
    const r = await httpGetJson(`http://127.0.0.1:${port}/bad`);
    expect(r.status).toBe(500);
  });

  test('rejects on connection refused', async () => {
    await expect(httpGetJson('http://127.0.0.1:1', 3000)).rejects.toBeDefined();
  });
});

describe('httpPostJson', () => {
  let server;
  let port;

  beforeAll((done) => {
    server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        const received = JSON.parse(body);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ received }));
      });
    });
    server.listen(0, () => { port = server.address().port; done(); });
  });

  afterAll(() => new Promise((resolve) => server.close(resolve)));

  test('sends JSON body and receives echoed response', async () => {
    const r = await httpPostJson(`http://127.0.0.1:${port}/echo`, { ping: 'pong' });
    expect(r.status).toBe(200);
    expect(r.data).toEqual({ received: { ping: 'pong' } });
  });
});
