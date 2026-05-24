jest.mock('../services/webapiBpsHealth/probe.service', () => ({
  runProbe: jest.fn().mockResolvedValue({ overall: 'UP', runId: 'x', durationMs: 5 }),
}));

describe('webapiBpsHealth scheduler', () => {
  test('start/stop without throw', () => {
    const { startWebapiBpsHealthScheduler, stopWebapiBpsHealthScheduler, INTERVAL_MS } =
      require('../services/webapiBpsHealth/scheduler.service');
    expect(INTERVAL_MS).toBe(15 * 60 * 1000);
    startWebapiBpsHealthScheduler();
    stopWebapiBpsHealthScheduler();
  });
});
