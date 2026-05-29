// Mock the heavy chat siblings so requiring chat.controller does not pull the
// LLM proxy / streaming chain at load. createIdentity uses none of them.
jest.mock('../../services/chat/streaming/openaiClient', () => ({ chat: jest.fn() }));
jest.mock('../../services/chat/streaming.service', () => ({ streamChatResponse: jest.fn() }));
jest.mock('../../services/chat/threadSuggestions.service', () => ({ generateForThread: jest.fn() }));

const express = require('express');
const request = require('supertest');
const chatController = require('../chat.controller');
const { verifyToken, issueToken } = require('../../services/chat/anonIdentity.service');

function makeApp() {
  const app = express();
  app.use(express.json());
  app.post('/chat/identity', chatController.createIdentity);
  return app;
}

describe('createIdentity', () => {
  it('mints a fresh uid + token when nothing is presented', async () => {
    const res = await request(makeApp()).post('/chat/identity').send({});
    expect(res.statusCode).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(typeof res.body.uid).toBe('string');
    expect(verifyToken(res.body.token).sub).toBe(res.body.uid);
    expect(res.body.exp).toBeGreaterThan(0);
  });

  it('adopts a well-formed legacy bare uid', async () => {
    const res = await request(makeApp()).post('/chat/identity').send({ uid: 'uid_1699999999_abc' });
    expect(res.statusCode).toBe(200);
    expect(res.body.uid).toBe('uid_1699999999_abc');
    expect(verifyToken(res.body.token).sub).toBe('uid_1699999999_abc');
  });

  it('renews for the same sub when a valid token is presented', async () => {
    const token = issueToken('user-Z');
    const res = await request(makeApp()).post('/chat/identity')
      .set('x-malika-token', token)
      .send({ uid: 'someone-else' }); // ignored in favor of the token sub
    expect(res.body.uid).toBe('user-Z');
    expect(verifyToken(res.body.token).sub).toBe('user-Z');
  });

  it('falls back to a fresh uid when the presented uid is malformed', async () => {
    const res = await request(makeApp()).post('/chat/identity').send({ uid: 'x'.repeat(200) });
    expect(res.statusCode).toBe(200);
    expect(res.body.uid).not.toBe('x'.repeat(200));
    expect(verifyToken(res.body.token).sub).toBe(res.body.uid);
  });
});
