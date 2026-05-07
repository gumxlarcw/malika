require('dotenv').config();
const vs = require('../src/services/ai/vectorSearch.service');
(async () => {
  const cache = await vs.loadKnowledgeEmbeddings();
  console.log('Cache loaded:', cache.length, 'entries');
  const entries27731 = cache.filter(e => e.id === 27731 || e.parentId === 27731);
  console.log('Doc 27731 entries:', entries27731.length);
  for (const e of entries27731.slice(0, 3)) {
    console.log('  id=' + e.id + ' parentId=' + (e.parentId || 'null') + ' hasIndicatorIdx=' + (e.indicatorIndex ? 'YES(' + e.indicatorIndex.length + ')' : 'NO'));
  }
  process.exit(0);
})();
