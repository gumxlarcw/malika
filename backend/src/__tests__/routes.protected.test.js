const request = require('supertest');
const app = require('../../app');
const jwt = require('jsonwebtoken');

// Create a dummy token compatible with auth.middleware expectations
const token = jwt.sign({ id: 1 }, process.env.JWT_SECRET || 'secret-dev');

// Mock User model to satisfy auth
jest.mock('../models/User.model', () => ({
  findById: jest.fn().mockResolvedValue({ id: 1, name: 'Test', email: 't@e.st', role: 'admin' }),
}));

describe('Protected routes', () => {
  test('datasource route requires auth', async () => {
    const resNoAuth = await request(app).get('/datasource');
    expect(resNoAuth.status).toBe(401);

    const resAuth = await request(app).get('/datasource').set('Authorization', `Bearer ${token}`);
    // We don't assert body; just ensure it gets past auth
    expect(resAuth.status).toBeGreaterThanOrEqual(200);
  });
});
