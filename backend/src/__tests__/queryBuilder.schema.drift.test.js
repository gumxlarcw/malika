const { getQueryBuilderToolParameters } = require('../services/ai/queryBuilder.service');

describe('queryBuilder tool schema drift', () => {
  test('tool parameters derive from JSON schema and strip meta keys', () => {
    const params = getQueryBuilderToolParameters();

    expect(params).toBeTruthy();
    expect(typeof params).toBe('object');

    // Must not include meta keys (OpenAI tool schema rejects them)
    expect(params.$schema).toBeUndefined();
    expect(params.$id).toBeUndefined();
    expect(params.title).toBeUndefined();

    // Core contract
    expect(params.type).toBe('object');
    expect(params.additionalProperties).toBe(false);
    expect(Array.isArray(params.required)).toBe(true);
    expect(params.required).toEqual(expect.arrayContaining(['version', 'intent', 'type', 'params', 'confidence']));
    expect(params.properties).toBeTruthy();
    expect(params.properties.version).toEqual(expect.objectContaining({ const: 1 }));
  });
});
