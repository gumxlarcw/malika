// NOTE: These tests exercise the xenova multilingual-e5-base pipeline which
// uses dynamic ESM imports. Jest's CommonJS VM doesn't support dynamic
// import() without --experimental-vm-modules, so this suite is skipped in
// the default jest run. The behaviour is verified via live smoke in the
// closeout step of the plan (curl POST /knowledge/embed/2 + DB row check).
//
// To run locally with ESM support:
//   NODE_OPTIONS='--experimental-vm-modules' npx jest src/__tests__/embeddingWrite.test.js
const { embedDatasource, clearEmbedding } =
  require('../services/ai/embedding.service');
const sequelize = require('../config/db');

jest.setTimeout(60_000);

const TEST_SID = 2; // IHK Halmahera Tengah - always present per data audit.

async function readState(sid) {
  const [rows] = await sequelize.query(
    `SELECT id, embedding_generated_at FROM retrieval_chunks
     WHERE source_kind='datasource' AND source_ref_id = ?`,
    { replacements: [sid] }
  );
  return rows[0] || null;
}

describe.skip('write paths (skipped — xenova needs ESM)', () => {
  test('embedDatasource upserts a retrieval_chunks row', async () => {
    const before = await readState(TEST_SID);
    const result = await embedDatasource(TEST_SID);
    expect(result).toHaveProperty('ok');
    expect(result.ok).toBe(true);

    const after = await readState(TEST_SID);
    expect(after).not.toBeNull();
    if (before) {
      expect(new Date(after.embedding_generated_at).getTime())
        .toBeGreaterThanOrEqual(new Date(before.embedding_generated_at).getTime());
    }
  });

  test('clearEmbedding removes the retrieval_chunks row for that source', async () => {
    await embedDatasource(TEST_SID);
    expect(await readState(TEST_SID)).not.toBeNull();
    await clearEmbedding(TEST_SID);
    expect(await readState(TEST_SID)).toBeNull();
    await embedDatasource(TEST_SID);
    expect(await readState(TEST_SID)).not.toBeNull();
  });
});

// Standalone helper test that doesn't trigger xenova load - sanity check the
// db state for source_kind='datasource' to confirm Phase C indexing covered
// the active source set.
test('retrieval_chunks for datasource kind is populated', async () => {
  const [rows] = await sequelize.query(
    `SELECT COUNT(*) AS n FROM retrieval_chunks WHERE source_kind='datasource'`
  );
  expect(Number(rows[0].n)).toBeGreaterThan(0);
});
