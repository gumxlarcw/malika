jest.mock('../services/analytics/analytics.service', () => ({
  trackPageView: jest.fn(async () => ({ success: true })),
}));

const analyticsController = require('../controllers/analytics.controller');

function createRes() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  };
}

describe('analytics controller snapshots', () => {
  it('returns validation error when sessionId missing', async () => {
    const req = { body: {} };
    const res = createRes();

    await analyticsController.trackPageView(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    const payload = res.json.mock.calls[0][0];
    expect(payload).toMatchSnapshot();
  });
});
