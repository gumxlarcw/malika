module.exports = {
  apps: [
    // ================================================
    // 1. Backend API Node (Express) - PRODUCTION ONLY
    // ================================================
    {
      name: "pds-backend",
      cwd: "./backend",
      script: "server.js",
      exec_mode: "fork",
      instances: 1,
      node_args: "--max-old-space-size=2048 --max-semi-space-size=32 --expose-gc --optimize-for-size",
      max_memory_restart: "2300M",

      // ── Resilience (added 2026-02-25) ──
      exp_backoff_restart_delay: 100,   // 100→150→225→...→15s cap, resets after 30s stable
      wait_ready: true,                  // Wait for process.send('ready') before marking online
      listen_timeout: 60000,             // 60s max wait for ready signal (embedding preload)
      kill_timeout: 10000,               // 10s graceful shutdown (up from default 1.6s)

      env: {
        NODE_ENV: "production",
        NODE_OPTIONS: "--max-old-space-size=2048 --max-semi-space-size=32 --expose-gc",
        VECTOR_CACHE_TTL_MINUTES: "360",
        PORT: 5000,
        AUTOMATION_ENABLED: "true",
        AUTOMATION_RUN_HOUR: 8,
        AUTOMATION_RUN_MINUTE: 0,
        AUTOMATION_INTERVAL_MINUTES: 30,
        PUBLICATION_NOTIFICATIONS_ENABLED: "true",
        PUBLICATION_INTERVAL_MINUTES: 30,
        MERGED_CACHE_NOTIFICATIONS_ENABLED: "true",
        MERGED_CACHE_NOTIFICATIONS_INTERVAL_MINUTES: 30
      },
      env_production: {
        NODE_ENV: "production",
        PORT: 5000,
        AUTOMATION_ENABLED: "true",
        AUTOMATION_RUN_HOUR: 8,
        AUTOMATION_RUN_MINUTE: 0,

        AUTOMATION_INTERVAL_MINUTES: 30,
        PUBLICATION_NOTIFICATIONS_ENABLED: "true",
        PUBLICATION_INTERVAL_MINUTES: 30,
        MERGED_CACHE_NOTIFICATIONS_ENABLED: "true",
        MERGED_CACHE_NOTIFICATIONS_INTERVAL_MINUTES: 30,

        // OpenAI (server-side only)
        // Set OPENAI_API_KEY_QUERY_BUILDER via `pm2 restart project-backend --update-env`
        // after exporting it in the environment (do not hardcode secrets here).
        OPENAI_QUERY_BUILDER_MODEL: "gemini-3-flash-preview",
        OPENAI_QUERY_BUILDER_MODEL_FALLBACK: "gemini-3-flash-preview"
      }
    },

    // ================================================
    // 2. Next.js Admin (PRODUCTION build)
    // ================================================
    {
      name: "pds-admin",
      cwd: "./backend/admin",
      script: ".next/standalone/server.js",
      exec_mode: "fork",
      instances: 1,
      max_memory_restart: "300M",
      env: {
        NODE_ENV: "production",
        PORT: 5050
      }
    },

    // ================================================
    // 3. Public Frontend (PWA) Next.js - PRODUCTION
    // ================================================
    {
      name: "pds-frontend",
      cwd: "./frontend",
      script: "node_modules/.bin/next",
      args: "start -p 6060",
      watch: false,
      exec_mode: "fork",
      instances: 1,
      max_memory_restart: "400M",
      env: {
        NODE_ENV: "production",
        PORT: 6060
      }
    }
  ]
};
