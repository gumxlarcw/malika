function expectObjectKeys(obj, keys) {
  keys.forEach((key) => {
    expect(obj).toHaveProperty(key);
  });
}

function expectSsePayload(payload, eventName) {
  expect(payload).toContain(`event: ${eventName}`);
  expect(payload).toContain("data:");
}

module.exports = {
  expectObjectKeys,
  expectSsePayload,
};
