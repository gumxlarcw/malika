const EventEmitter = require('events');
const { createSSEHandler } = require('../services/chat/streaming/sse.service');
const { expectSsePayload } = require('./helpers/assertions');

function createMockRes() {
  const res = new EventEmitter();
  res.setHeader = jest.fn();
  res.write = jest.fn();
  res.end = jest.fn();
  return res;
}

describe('sse.service', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('sets SSE headers and writes events', () => {
    const res = createMockRes();
    const handler = createSSEHandler({ res, threadId: 99, heartbeatMs: 0 });

    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/event-stream');
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-cache');
    expect(res.setHeader).toHaveBeenCalledWith('Connection', 'keep-alive');

    handler.sendEvent('message', { ok: true });
    const payload = res.write.mock.calls[0][0];
    expectSsePayload(payload, 'message');
  });

  it('sends heartbeat events on interval', () => {
    const res = createMockRes();
    const handler = createSSEHandler({ res, threadId: 't1', heartbeatMs: 10 });

    jest.advanceTimersByTime(25);

    expect(res.write).toHaveBeenCalled();
    const payload = res.write.mock.calls[0][0];
    expectSsePayload(payload, 'heartbeat');

    handler.end();
  });

  it('ends connection cleanly', () => {
    const res = createMockRes();
    const handler = createSSEHandler({ res, threadId: 't2', heartbeatMs: 0 });

    handler.end();

    expect(handler.isClientConnected()).toBe(false);
    expect(res.end).toHaveBeenCalled();
  });
});
