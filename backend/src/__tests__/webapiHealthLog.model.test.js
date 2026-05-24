describe('WebapiHealthLog model', () => {
  test('loads without throwing', () => {
    const M = require('../models/WebapiHealthLog.model');
    expect(M).toBeDefined();
    expect(M.tableName).toBe('webapi_health_logs');
  });

  test('has required fields', () => {
    const M = require('../models/WebapiHealthLog.model');
    const attrs = M.rawAttributes;
    expect(attrs.run_id).toBeDefined();
    expect(attrs.probe_kind).toBeDefined();
    expect(attrs.endpoint_family).toBeDefined();
    expect(attrs.ok).toBeDefined();
  });
});
