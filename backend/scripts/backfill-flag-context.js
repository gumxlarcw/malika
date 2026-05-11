#!/usr/bin/env node
'use strict';
/**
 * One-shot backfill: populate user_query + assistant_response on chat_message_flags
 * rows whose direct-INSERT creation bypassed errorLearning.service.flagMessage()'s
 * auto-fill logic (which looks up chat_messages by message_id).
 *
 * The auto-fill is defined in src/services/chat/errorLearning.service.js — it
 * walks back from the assistant message to the immediately prior user message
 * in the same thread. This script applies the same walk retroactively to any
 * NULL rows.
 *
 * Idempotent: only touches rows where user_query OR assistant_response is NULL.
 * Resume-safe: each row update is independent; partial runs can be re-run.
 *
 * Flags:
 *   --dry-run    Report what would change without writing.
 *
 * Usage:
 *   cd backend && node scripts/backfill-flag-context.js
 *   cd backend && node scripts/backfill-flag-context.js --dry-run
 *
 * Originally needed 2026-05-11 after surfacing that 24 of 30 historical flags
 * (from a 2026-01-20 raw-INSERT backfill) had NULL context fields, which made
 * the admin /backend/malika-analysis flag detail modal show "-" for query and
 * response. Keep this script available for any future bulk-flag-import that
 * skips the service layer.
 */

require('dotenv').config({ quiet: true });
const { Op } = require('sequelize');
const sequelize = require('../src/config/db');
const ChatMessageFlag = require('../src/models/ChatMessageFlag.model');
const ChatMessage = require('../src/models/ChatMessage.model');

const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  const targets = await ChatMessageFlag.findAll({
    where: {
      [Op.or]: [{ user_query: null }, { assistant_response: null }],
      message_id: { [Op.not]: null },
    },
  });

  console.log(`[backfill-flag-context] candidates: ${targets.length}${DRY_RUN ? ' (DRY RUN — no writes)' : ''}`);
  if (targets.length === 0) {
    console.log('[backfill-flag-context] nothing to do');
    return { filled: 0, skipped: 0, orphaned: 0 };
  }

  let filled = 0;
  let skipped = 0;
  let orphaned = 0;

  for (const flag of targets) {
    const assistantMsg = await ChatMessage.findByPk(flag.message_id);
    if (!assistantMsg) {
      orphaned += 1;
      console.log(`  flag id=${flag.id} → message_id=${flag.message_id} not found (orphaned, can't recover)`);
      continue;
    }
    if (assistantMsg.role !== 'assistant') {
      skipped += 1;
      console.log(`  flag id=${flag.id} → message_id=${flag.message_id} role=${assistantMsg.role} (expected 'assistant', skipping)`);
      continue;
    }

    const prevUser = await ChatMessage.findOne({
      where: { thread_id: assistantMsg.thread_id, id: { [Op.lt]: assistantMsg.id }, role: 'user' },
      order: [['id', 'DESC']],
    });

    const updates = {};
    if (!flag.user_query && prevUser) updates.user_query = prevUser.content;
    if (!flag.assistant_response) updates.assistant_response = assistantMsg.content;

    if (Object.keys(updates).length === 0) {
      skipped += 1;
      continue;
    }

    if (DRY_RUN) {
      console.log(`  WOULD UPDATE flag id=${flag.id} fields=[${Object.keys(updates).join(', ')}]`);
    } else {
      await flag.update(updates);
    }
    filled += 1;
  }

  console.log(`[backfill-flag-context] ${DRY_RUN ? 'would fill' : 'filled'}: ${filled}, skipped: ${skipped}, orphaned: ${orphaned}`);

  const [rows] = await sequelize.query(
    'SELECT COUNT(*) AS total, SUM(user_query IS NULL) AS q_null, SUM(assistant_response IS NULL) AS r_null FROM chat_message_flags'
  );
  console.log(`[backfill-flag-context] post-run state:`, rows[0]);

  return { filled, skipped, orphaned };
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[backfill-flag-context] failed:', err);
    process.exit(1);
  });
