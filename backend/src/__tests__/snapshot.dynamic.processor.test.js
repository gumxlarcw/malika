const processDynamic = require('../services/processor/dynamic.processor');
const { sampleDynamicApi } = require('./helpers/fixtures');

describe('dynamic.processor snapshot', () => {
  it('builds processed response', () => {
    const result = processDynamic(sampleDynamicApi);
    expect(result).toMatchSnapshot();
  });
});
