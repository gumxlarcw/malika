const request = require('supertest');
const app = require('../../app');
const jwt = require('jsonwebtoken');

const token = jwt.sign({ id: 1 }, process.env.JWT_SECRET || 'secret-dev');

jest.mock('../models/User.model', () => ({
  findById: jest.fn().mockResolvedValue({ id: 1, name: 'Test', email: 't@e.st', role: 'admin' }),
}));

describe('Protected routes (period, summary)', () => {
  test('period requires auth', async () => {
    const resNoAuth = await request(app).get('/period');
    expect(resNoAuth.status).toBe(401);
    const resAuth = await request(app).get('/period').set('Authorization', `Bearer ${token}`);
    expect(resAuth.status).toBeGreaterThanOrEqual(200);
  });

  test('summary requires auth', async () => {
    const resNoAuth = await request(app).get('/summary');
    expect(resNoAuth.status).toBe(401);
    const resAuth = await request(app).get('/summary').set('Authorization', `Bearer ${token}`);
    expect(resAuth.status).toBeGreaterThanOrEqual(200);
  });
});
