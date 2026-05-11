// server.js
// Load env as early as possible so any modules reading process.env see correct values.
const { port } = require("./src/config/env");
const { ensureSearchFullTextIndexes } = require('./src/migrations/search-fulltext-indexes');

const path = require("path");
const app = require("./app");
const sequelize = require("./src/config/db");

async function ensureDataSourceTypeEnumSupportsAllKnownTypes() {
    try {
        const [rows] = await sequelize.query(
            "SELECT COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='data_sources' AND COLUMN_NAME='type'"
        );
        const row = Array.isArray(rows) ? rows[0] : null;
        const columnType = row?.COLUMN_TYPE;

        if (!columnType || typeof columnType !== 'string') return;
        if (!columnType.toLowerCase().startsWith('enum(')) return;

        // Parse enum('a','b','c') into ['a','b','c']
        const values = Array.from(columnType.matchAll(/'((?:\\'|[^'])*)'/g)).map((m) => m[1].replace(/\\'/g, "'"));

        const required = ['exim', 'pressrelease'];
        const missing = required.filter((v) => !values.includes(v));
        if (missing.length === 0) return;

        const nextValues = [...values, ...missing];
        const enumSql = nextValues.map((v) => `'${String(v).replace(/'/g, "\\'")}'`).join(',');
        const notNullSql = String(row?.IS_NULLABLE).toUpperCase() === 'NO' ? 'NOT NULL' : '';
        const defaultSql = row?.COLUMN_DEFAULT ? `DEFAULT '${String(row.COLUMN_DEFAULT).replace(/'/g, "\\'")}'` : '';

        console.log(`[db] Migrating data_sources.type enum to include: ${missing.join(', ')}...`);
        await sequelize.query(`ALTER TABLE data_sources MODIFY COLUMN type ENUM(${enumSql}) ${notNullSql} ${defaultSql}`);
        console.log("[db] ✅ data_sources.type enum updated");
    } catch (e) {
        // Best-effort: do not block server start.
        console.warn("[db] WARN: failed to migrate data_sources.type enum:", e?.message || String(e));
    }
}

async function ensureDataSourceHasAliasesColumn() {
    try {
        const [rows] = await sequelize.query(
            "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='data_sources' AND COLUMN_NAME='aliases'"
        );
        const row = Array.isArray(rows) ? rows[0] : null;
        if (row?.COLUMN_NAME) return;

        console.log("[db] Migrating: adding data_sources.aliases column...");
        await sequelize.query("ALTER TABLE data_sources ADD COLUMN aliases TEXT NULL");
        console.log("[db] ✅ data_sources.aliases added");
    } catch (e) {
        // Best-effort: do not block server start.
        console.warn("[db] WARN: failed to add data_sources.aliases:", e?.message || String(e));
    }
}

async function ensureAppSettingsTableExists() {
    try {
        await sequelize.query(
            "CREATE TABLE IF NOT EXISTS app_settings (\n" +
                "  `key` VARCHAR(191) NOT NULL,\n" +
                "  value_json LONGTEXT NULL,\n" +
                "  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,\n" +
                "  PRIMARY KEY (`key`)\n" +
                ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;"
        );
    } catch (e) {
        // Best-effort: do not block server start.
        console.warn("[db] WARN: failed to ensure app_settings table:", e?.message || String(e));
    }
}

// =============================
// LOAD SEMUA MODEL SEBELUM SYNC
// =============================
require("./src/models/User.model");            // ⬅ Tambahan baru!
require("./src/models/DataSource.model");
require("./src/models/DataPeriod.model");
require("./src/models/ProcessedCache.model");
require("./src/models/FetchLog.model");
require("./src/models/MergedCache.model");
require("./src/models/AutomationConfig.model");
require("./src/models/AutomationRunLog.model");
require("./src/models/EximPodFilter.model");
require("./src/models/Notification.model");
require("./src/models/PushSubscription.model");
require("./src/models/PushSendLog.model");
require("./src/models/AppSetting.model");
require("./src/models/DataSourceSearchTerm.model");
require("./src/models/SearchStat.model");
require("./src/models/ChatThread.model");
require("./src/models/ChatMessage.model");
require("./src/models/ChatFeedback.model");
require("./src/models/ChatMessageFlag.model"); // Error tracking - flagged messages
require("./src/models/ChatErrorPattern.model"); // Error learning patterns
require("./src/models/KnowledgeBase.model"); // RAG knowledge documents

// =============================
// LOAD STATIC ADMIN PANEL (HTML)
// =============================
app.use("/", require("express").static(path.join(__dirname, "public")));

// =============================
// START SERVER
// =============================
// Listen first so PM2 marks the process "online" immediately and systemd unit
// activation is not stuck waiting on DB-bound migrations when the box is thrashing.
// DB readiness + migrations run in the background; /readyz reflects that state.
app.locals.dbReady = false;

app.get('/readyz', (_req, res) => {
    res.status(app.locals.dbReady ? 200 : 503).json({ ready: app.locals.dbReady });
});

const server = app.listen(port, () => {
    console.log("🚀 Server listening on port " + port + " (DB warmup in background)");
});

(async function warmup() {
    const authRetryMs = 5000;
    for (;;) {
        try {
            await sequelize.authenticate();
            console.log("✅ Database connected!");
            break;
        } catch (error) {
            console.warn("[db] authenticate failed, retrying in " + authRetryMs + "ms:", error?.message || String(error));
            await new Promise(r => setTimeout(r, authRetryMs));
        }
    }

    try {
        await ensureDataSourceTypeEnumSupportsAllKnownTypes();
        await ensureDataSourceHasAliasesColumn();
        await ensureAppSettingsTableExists();
        await ensureSearchFullTextIndexes();

        console.log("Syncing models...");
        await sequelize.sync();
    } catch (error) {
        console.error("[db] warmup migration failed:", error?.message || String(error));
    }

    app.locals.dbReady = true;

    // Best-effort schedulers — only start after DB is ready
    for (const [label, loader] of [
        ['automation',     () => require('./src/services/automation/scheduler.service').startAutomationScheduler()],
        ['publication',    () => require('./src/services/publication/scheduler.service').startPublicationNotificationScheduler()],
        ['mergedcache',    () => require('./src/services/notification/mergedCacheScheduler.service').startMergedCacheNotificationScheduler()],
        ['pressrelease',   () => require('./src/services/pressrelease/scheduler.service').startPressReleaseNotificationScheduler()],
        ['knowledge-sync', () => require('./src/services/rag/knowledgeSyncScheduler.service').startKnowledgeSyncScheduler()],
        ['petatematik',    () => require('./src/services/petaTematik/petaTematik.service').initIndikatorList()],
    ]) {
        try {
            await loader();
        } catch (e) {
            console.warn(`[${label}] scheduler init failed:`, e?.message);
        }
    }

    // Daily retention purge — fetch_logs (90d) / automation_run_logs (30d) / admin_audit_logs (365d).
    // Schedule first so the next run fires in 24h regardless of the on-startup outcome.
    try {
        const { runRetention } = require('./src/jobs/retention.job');
        setInterval(runRetention, 24 * 60 * 60 * 1000);
        runRetention();
    } catch (e) {
        console.warn('[retention] init failed:', e?.message);
    }
})();

process.on('SIGTERM', () => {
    console.log('SIGTERM received — closing HTTP server');
    server.close(() => process.exit(0));
});
