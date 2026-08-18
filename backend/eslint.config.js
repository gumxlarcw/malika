'use strict';

/**
 * Flat config (ESLint v9+). The backend is CommonJS on Node 20 — see
 * .claude/rules/code-style.md. Scope is correctness, not formatting: there is no
 * Prettier here and reformatting the tree would bury real findings in noise.
 */

const js = require('@eslint/js');

module.exports = [
  {
    ignores: [
      'node_modules/**',
      'admin/**',        // separate Next.js app with its own eslint-config-next
      'coverage/**',
      '**/*.backup',
      '**/*.backup[0-9]',
    ],
  },
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'commonjs',
      globals: {
        require: 'readonly',
        module: 'writable',
        exports: 'writable',
        process: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        TextEncoder: 'readonly',
        TextDecoder: 'readonly',
        AbortController: 'readonly',
        AbortSignal: 'readonly',
        fetch: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        setImmediate: 'readonly',
        queueMicrotask: 'readonly',
        structuredClone: 'readonly',
        performance: 'readonly',
        global: 'readonly',
        globalThis: 'readonly',
        crypto: 'readonly',
        DOMException: 'readonly',
        Blob: 'readonly',
        Event: 'readonly',
        EventTarget: 'readonly',
        Headers: 'readonly',
        Request: 'readonly',
        Response: 'readonly',
        FormData: 'readonly',
        ReadableStream: 'readonly',
        WritableStream: 'readonly',
        TransformStream: 'readonly',
        MessageChannel: 'readonly',
        atob: 'readonly',
        btoa: 'readonly',
      },
    },
    rules: {
      // Posture: correctness rules from js.configs.recommended stay ERRORS and
      // gate CI — they are the ones that catch real defects (no-undef found a
      // live ReferenceError in automationRunner; no-unreachable found 187 dead
      // lines in exim.controller). The rules below flag accumulated cruft that
      // predates linting; they are reported as WARNINGS so the gate stays
      // meaningful instead of being switched off wholesale. Burn them down and
      // promote each back to 'error'.
      'no-unused-vars': ['warn', {
        args: 'none',
        caughtErrors: 'none',
        varsIgnorePattern: '^_',
      }],
      'no-useless-escape': 'warn',
      'no-empty': 'warn',
      'no-misleading-character-class': 'warn',
      'no-control-regex': 'warn',
      'no-prototype-builtins': 'warn',
    },
  },
  {
    files: ['**/__tests__/**/*.js', '**/*.test.js', 'jest.setup.env.js'],
    languageOptions: {
      globals: {
        describe: 'readonly', it: 'readonly', test: 'readonly', expect: 'readonly',
        beforeAll: 'readonly', afterAll: 'readonly', beforeEach: 'readonly',
        afterEach: 'readonly', jest: 'readonly',
      },
    },
  },
];
