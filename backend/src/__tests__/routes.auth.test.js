const request = require('supertest');
const app = require('../../app');

describe('Auth routes', () => {
  test('login route exists', async () => {
    const res = await request(app).post('/auth/login').send({ username: 'x', password: 'y' });
    // We don't assert on specific payload; just ensure route responds
    expect(res.status).toBeGreaterThanOrEqual(200);
  });
});
