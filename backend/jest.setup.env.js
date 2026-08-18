// jest.setup.env.js — loads backend/.env so tests inherit the OPENAI_API_URL /
// OPENAI_API_BASE_URL vars that the chat/AI services now require at module load
// (per the 2026-05-16 proxy-only rule). Without this, importing any module that
// checks process.env.OPENAI_API_URL at load time crashes the test before describe runs.
const dotenvResult = require('dotenv').config();

// dotenv reports a failed read in its return value and injects nothing — it does not
// throw. This repo is root-owned, so running the suite as a normal user gets EACCES
// here and then ~22 suites die on "OPENAI_API_URL env var must be set", a message that
// blames the variable instead of the file nobody could read. Say what actually happened.
//
// ENOENT stays tolerated deliberately: CI has no backend/.env at all and passes every
// variable through the workflow env (see .github/workflows/checks.yml), so throwing on
// a missing file would break the build.
if (dotenvResult.error && dotenvResult.error.code !== 'ENOENT') {
  const envPath = dotenvResult.error.path || 'backend/.env';
  const code = dotenvResult.error.code || dotenvResult.error.message;
  throw new Error(
    `jest.setup.env.js: could not read ${envPath} (${code}), so dotenv injected 0 variables. ` +
    'Every suite that imports the chat/AI modules will fail on a missing OPENAI_API_URL ' +
    'until this is fixed. Run the suite as a user that can read the file:\n' +
    '  cd backend && sudo -n env DB_NAME=testdb DB_USER=testuser DB_PASS=testpass DB_HOST=localhost JWT_SECRET=test-secret SKIP_DB_TESTS=1 npx jest --ci --passWithNoTests\n' +
    'Or export OPENAI_API_URL / OPENAI_API_BASE_URL (plus the DB and JWT vars) yourself, the way CI does.'
  );
}
