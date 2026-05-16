// jest.setup.env.js — loads backend/.env so tests inherit the OPENAI_API_URL /
// OPENAI_API_BASE_URL vars that the chat/AI services now require at module load
// (per the 2026-05-16 proxy-only rule). Without this, importing any module that
// checks process.env.OPENAI_API_URL at load time crashes the test before describe runs.
require('dotenv').config();
