#!/usr/bin/env node
/**
 * GitHub Copilot Authentication Helper
 *
 * Performs the GitHub device flow to obtain a long-lived OAuth token,
 * then saves it to ~/.openclaw/auth-profiles.json so copilot-proxy.js
 * can auto-refresh Copilot API tokens indefinitely.
 *
 * Usage:
 *   node scripts/copilot-auth.js           # Interactive device flow
 *   node scripts/copilot-auth.js --status  # Check token status
 *
 * After running once, copilot-proxy will auto-refresh forever
 * (until you revoke the token on github.com).
 */

'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');

// ─── GitHub OAuth App (Copilot's own client) ────────────────────────────────
// These are the well-known GitHub Copilot OAuth client IDs used by VS Code.
const GITHUB_CLIENT_ID = 'Iv1.b507a08c87ecfe98';
const GITHUB_DEVICE_CODE_URL = 'https://github.com/login/device/code';
const GITHUB_ACCESS_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const COPILOT_TOKEN_URL = 'https://api.github.com/copilot_internal/v2/token';

const AUTH_PROFILES_PATH = path.join(
  process.env.HOME || '/root',
  '.openclaw/auth-profiles.json'
);
const GITHUB_TOKEN_PATH = path.join(
  process.env.HOME || '/root',
  '.openclaw/credentials/github-copilot.token.json'
);

// ─── Helpers ────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function loadAuthProfiles() {
  try {
    return JSON.parse(fs.readFileSync(AUTH_PROFILES_PATH, 'utf-8'));
  } catch {
    return {};
  }
}

function saveAuthProfiles(profiles) {
  fs.mkdirSync(path.dirname(AUTH_PROFILES_PATH), { recursive: true });
  fs.writeFileSync(AUTH_PROFILES_PATH, JSON.stringify(profiles, null, 2));
}

// ─── Status Check ───────────────────────────────────────────────────────────

async function checkStatus() {
  console.log('\n━━━ GitHub Copilot Auth Status ━━━\n');

  // 1. Check GitHub OAuth token
  const profiles = loadAuthProfiles();
  const profile = profiles['github-copilot:github'];
  if (profile?.token) {
    const masked = profile.token.slice(0, 8) + '...' + profile.token.slice(-4);
    console.log(`✅ GitHub OAuth token: ${masked}`);
    console.log(`   Saved at: ${AUTH_PROFILES_PATH}`);

    // Validate by calling GitHub API
    try {
      const res = await fetch('https://api.github.com/user', {
        headers: { Authorization: `Bearer ${profile.token}`, Accept: 'application/json' },
      });
      if (res.ok) {
        const user = await res.json();
        console.log(`   GitHub user: ${user.login}`);
      } else {
        console.log(`   ⚠️  Token may be invalid (HTTP ${res.status})`);
      }
    } catch (e) {
      console.log(`   ⚠️  Could not validate: ${e.message}`);
    }
  } else {
    console.log(`❌ GitHub OAuth token: NOT FOUND`);
    console.log(`   Run: node scripts/copilot-auth.js`);
  }

  // 2. Check Copilot API token
  console.log('');
  try {
    const cached = JSON.parse(fs.readFileSync(GITHUB_TOKEN_PATH, 'utf-8'));
    const expiresAt = new Date(cached.expiresAt);
    const now = new Date();
    const remaining = expiresAt - now;
    const hours = Math.floor(remaining / 3600000);
    const mins = Math.floor((remaining % 3600000) / 60000);

    if (remaining > 0) {
      console.log(`✅ Copilot API token: VALID (expires in ${hours}h ${mins}m)`);
    } else {
      console.log(`❌ Copilot API token: EXPIRED (${Math.abs(hours)}h ${Math.abs(mins)}m ago)`);
    }
    console.log(`   Expires: ${expiresAt.toISOString()}`);
    if (cached.updatedAt) {
      console.log(`   Updated: ${new Date(cached.updatedAt).toISOString()}`);
    }
  } catch {
    console.log(`❌ Copilot API token: NOT FOUND`);
  }

  // 3. Check if auto-refresh will work
  console.log('');
  if (profile?.token) {
    console.log(`✅ Auto-refresh: ENABLED (proxy can refresh tokens automatically)`);
  } else {
    console.log(`❌ Auto-refresh: DISABLED (proxy will fail when Copilot token expires)`);
    console.log(`   Fix: node scripts/copilot-auth.js`);
  }

  console.log('');
}

// ─── Device Flow ────────────────────────────────────────────────────────────

async function deviceFlow() {
  console.log('\n━━━ GitHub Copilot Device Flow Authentication ━━━\n');
  console.log('This will obtain a long-lived GitHub OAuth token so');
  console.log('copilot-proxy can auto-refresh Copilot API tokens forever.\n');

  // Step 1: Request device code
  console.log('Step 1/3: Requesting device code...');
  const codeRes = await fetch(GITHUB_DEVICE_CODE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      client_id: GITHUB_CLIENT_ID,
      scope: 'read:user',
    }),
  });

  if (!codeRes.ok) {
    const err = await codeRes.text();
    console.error(`Failed to get device code: HTTP ${codeRes.status}\n${err}`);
    process.exit(1);
  }

  const codeData = await codeRes.json();
  const { device_code, user_code, verification_uri, interval = 5, expires_in } = codeData;

  console.log(`\nStep 2/3: Authorize this device\n`);
  console.log(`  1. Open:  ${verification_uri}`);
  console.log(`  2. Enter: ${user_code}\n`);
  console.log(`  Code expires in ${Math.floor(expires_in / 60)} minutes.`);
  console.log(`  Waiting for authorization...`);

  // Step 2: Poll for token
  const deadline = Date.now() + expires_in * 1000;
  let pollInterval = (interval || 5) * 1000;
  let token = null;

  while (Date.now() < deadline) {
    await sleep(pollInterval);

    const tokenRes = await fetch(GITHUB_ACCESS_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        client_id: GITHUB_CLIENT_ID,
        device_code,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      }),
    });

    const tokenData = await tokenRes.json();

    if (tokenData.access_token) {
      token = tokenData.access_token;
      break;
    }

    if (tokenData.error === 'authorization_pending') {
      process.stdout.write('.');
      continue;
    }

    if (tokenData.error === 'slow_down') {
      pollInterval += 5000;
      continue;
    }

    if (tokenData.error === 'expired_token') {
      console.error('\n\nDevice code expired. Please try again.');
      process.exit(1);
    }

    if (tokenData.error === 'access_denied') {
      console.error('\n\nAuthorization denied by user.');
      process.exit(1);
    }

    console.error(`\nUnexpected response: ${JSON.stringify(tokenData)}`);
    process.exit(1);
  }

  if (!token) {
    console.error('\n\nTimed out waiting for authorization.');
    process.exit(1);
  }

  console.log('\n\n✅ GitHub OAuth token obtained!');

  // Step 3: Save OAuth token to auth-profiles.json
  console.log('\nStep 3/3: Saving tokens...');

  const profiles = loadAuthProfiles();
  profiles['github-copilot:github'] = {
    token,
    provider: 'github-copilot',
    mode: 'token',
    savedAt: new Date().toISOString(),
  };
  saveAuthProfiles(profiles);
  console.log(`  ✅ GitHub OAuth token saved to ${AUTH_PROFILES_PATH}`);

  // Also try to exchange for Copilot API token immediately
  try {
    const copilotRes = await fetch(COPILOT_TOKEN_URL, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
      },
    });

    if (copilotRes.ok) {
      const copilotData = await copilotRes.json();
      if (copilotData.token) {
        let expiresAt = copilotData.expires_at;
        if (typeof expiresAt === 'number') {
          expiresAt = expiresAt > 10_000_000_000 ? expiresAt : expiresAt * 1000;
        }

        fs.mkdirSync(path.dirname(GITHUB_TOKEN_PATH), { recursive: true });
        fs.writeFileSync(GITHUB_TOKEN_PATH, JSON.stringify({
          token: copilotData.token,
          expiresAt,
          updatedAt: Date.now(),
        }, null, 2));

        const expDate = new Date(expiresAt);
        console.log(`  ✅ Copilot API token refreshed (expires ${expDate.toISOString()})`);
      }
    } else {
      console.log(`  ⚠️  Could not exchange for Copilot API token (HTTP ${copilotRes.status})`);
      console.log(`     The proxy will exchange it on next request.`);
    }
  } catch (e) {
    console.log(`  ⚠️  Could not exchange for Copilot API token: ${e.message}`);
  }

  // Restart copilot-proxy if running
  console.log('\n━━━ Done! ━━━');
  console.log('Auto-refresh is now enabled. The proxy will refresh tokens automatically.');
  console.log('To restart the proxy: pm2 restart copilot-proxy');
  console.log('To check status:      node scripts/copilot-auth.js --status\n');
}

// ─── Main ───────────────────────────────────────────────────────────────────

(async () => {
  const args = process.argv.slice(2);

  if (args.includes('--status') || args.includes('-s')) {
    await checkStatus();
  } else {
    await deviceFlow();
  }
})();
