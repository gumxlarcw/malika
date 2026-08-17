// app.js
const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const rateLimit = require("express-rate-limit");

const { authMiddleware, requireAdmin } = require("./src/middleware/auth.middleware");
const { csrfMiddleware, getCsrfToken } = require("./src/middleware/csrf.middleware");
const { createAuditLogMiddleware } = require("./src/middleware/auditLog.middleware");

// ROUTES
const authRoutes = require("./src/routes/auth.routes");
const datasourceRoutes = require("./src/routes/datasource.routes");
const dynamicRoutes = require("./src/routes/dynamic.routes");
const pressreleaseRoutes = require("./src/routes/pressrelease.routes");
const periodRoutes = require("./src/routes/period.routes");
const periodAvailableRoutes = require("./src/routes/period.available.routes");
const periodAvailableMonthRoutes = require("./src/routes/period.available.month.routes");
const periodPublicRoutes = require("./src/routes/period.public.routes");
const interopRoutes = require("./src/routes/interop.routes");
const staticRoutes = require("./src/routes/static.routes");
const eximRoutes = require("./src/routes/exim.routes");
const summaryRoutes = require("./src/routes/summary.routes");
const cacheRoutes = require("./src/routes/cache.routes");
const automationRoutes = require("./src/routes/automation.routes");
const geojsonRoutes = require("./src/routes/geojson.routes");
const metabaseRoutes = require("./src/routes/metabase.routes");
const notificationsRoutes = require("./src/routes/notifications.routes");
const notificationsAdminRoutes = require("./src/routes/notifications.admin.routes");
const pushRoutes = require("./src/routes/push.routes");
const searchRoutes = require("./src/routes/search.routes");
const searchAdminRoutes = require("./src/routes/search.admin.routes");
const categoriesRoutes = require("./src/routes/categories.routes");
const aiRoutes = require("./src/routes/ai.routes");
const chatRoutes = require("./src/routes/chat.routes");
const chatAdminRoutes = require("./src/routes/chat.admin.routes");
const knowledgeRoutes = require("./src/routes/knowledge.routes");
const errorLearningRoutes = require("./src/routes/errorLearning.routes");
const logsRoutes = require("./src/routes/logs.routes");
const webapiBpsRoutes = require("./src/routes/webapiBps.routes");
const analyticsRoutes = require("./src/routes/analytics.routes");

const app = express();

// ===========================
// GLOBAL MIDDLEWARE
// ===========================
// Behind Cloudflared/Reverse proxy, trust only local proxy to avoid permissive trust
// Cloudflared forwards from 127.0.0.1 to backend, so restrict trust to loopback
app.set('trust proxy', '127.0.0.1');

// Security headers via Helmet
// Customized to work with our API (disable contentSecurityPolicy for API responses)
app.use(helmet({
    contentSecurityPolicy: false, // API responses don't need CSP
    crossOriginEmbedderPolicy: false, // Allow embedding from admin/PWA
    crossOriginResourcePolicy: { policy: "cross-origin" }, // Allow cross-origin resource access
}));

app.use(cors({
    origin: [
        "https://api-malika.bpsmalut.com",
        "https://malika.bpsmalut.com"
    ],
    credentials: true
}));

// Body parser with size limit to prevent DoS attacks
app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());

// ===========================
// PUBLIC API (TIDAK PERLU LOGIN)
// ===========================
app.use("/dynamic", dynamicRoutes);
app.use("/pressrelease", pressreleaseRoutes);
app.use("/interop", interopRoutes);
app.use("/static", staticRoutes);
app.use("/exim", eximRoutes);
app.use("/metabase", metabaseRoutes);
app.use("/notifications", notificationsRoutes);
app.use("/push", pushRoutes);
app.use("/search", searchRoutes);
app.use("/categories", categoriesRoutes);
app.use("/analytics", analyticsRoutes);

// Public helper: period discovery for the PWA (no auth, rate-limited)
const publicPeriodLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 120,
    standardHeaders: true,
    legacyHeaders: false,
});
app.use("/period/public", publicPeriodLimiter, periodPublicRoutes);

// Peta Tematik public (PWA) — no auth, rate-limited (120/min)
const petaTematikPublicLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 120,
    standardHeaders: true,
    legacyHeaders: false,
});
app.use("/peta-tematik/public", petaTematikPublicLimiter, require("./src/routes/peta-tematik.public.routes"));

// Dashboard public (PWA) — no auth, rate-limited (120/min)
const dashboardPublicLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 120,
    standardHeaders: true,
    legacyHeaders: false,
});
app.use("/dashboard/public", dashboardPublicLimiter, require("./src/routes/dashboard.public.routes"));

// AI helpers (public but rate-limited; server-side only)
const aiLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
});
app.use("/ai", aiLimiter, aiRoutes);

// Public chat (rate-limited; requires x-malika-uid header from PWA)
const chatLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
        try {
            const uidRaw = req.get('x-malika-uid') || req.get('x-malika-user') || '';
            const uid = String(uidRaw || '').trim().slice(0, 100);
            // Combine IP + UID to reduce abuse and avoid UID-only sharing behind NAT.
            return uid ? `${req.ip || ''}|${uid}` : String(req.ip || '');
        } catch {
            return String(req.ip || '');
        }
    },
});
app.use("/chat", chatLimiter, chatRoutes);

// Chat feedback (public with x-malika-uid header)
const chatFeedbackRoutes = require("./src/routes/chatFeedback.routes");
app.use("/chat-feedback", chatLimiter, chatFeedbackRoutes);

// GeoJSON raw files are served publicly from backend/public via express.static in server.js.
// Upload endpoint is protected (admin-only) inside geojsonRoutes.
app.use("/geojson", geojsonRoutes);

// ===========================
// AUTH ROUTES (login/logout)
// ===========================
app.use("/auth", authRoutes);

// CSRF token endpoint (authenticated users can get a fresh token)
app.get("/csrf-token", authMiddleware, getCsrfToken);

// ===========================
// ADMIN / DASHBOARD (HARUS LOGIN + CSRF)
// ===========================
// Rate limiters
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 50,
    standardHeaders: true,
    legacyHeaders: false,
});

const apiLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
});

app.use("/auth", authLimiter);

// Apply CSRF protection to admin routes (POST/PUT/PATCH/DELETE require token)
app.use("/datasource", authMiddleware, csrfMiddleware, apiLimiter, createAuditLogMiddleware({ resource: 'datasource' }), datasourceRoutes);
app.use("/period", authMiddleware, csrfMiddleware, apiLimiter, periodRoutes);
app.use("/period/available", authMiddleware, apiLimiter, periodAvailableRoutes);
app.use("/period/available", authMiddleware, apiLimiter, periodAvailableMonthRoutes);
app.use("/summary", authMiddleware, apiLimiter, summaryRoutes);
app.use("/cache", authMiddleware, csrfMiddleware, apiLimiter, createAuditLogMiddleware({ resource: 'cache' }), cacheRoutes);
// Public PWA: notification tools are callable without user auth.
// NOTE: destructive actions may require a token (see controller).
app.use("/notifications/admin", apiLimiter, notificationsAdminRoutes);
app.use("/automation", authMiddleware, csrfMiddleware, apiLimiter, requireAdmin, createAuditLogMiddleware({ resource: 'automation' }), automationRoutes);

// Admin-only: debug endpoints for search (never log or return raw queries)
app.use("/search/admin", authMiddleware, apiLimiter, requireAdmin, searchAdminRoutes);

// Admin-only: view all chat conversations
app.use("/chat/admin", authMiddleware, apiLimiter, requireAdmin, chatAdminRoutes);

// Admin-only: Knowledge Base / RAG management
app.use("/knowledge", authMiddleware, csrfMiddleware, apiLimiter, createAuditLogMiddleware({ resource: 'knowledge' }), knowledgeRoutes);

// Error Learning: flag messages (public) + admin management
app.use("/error-learning", chatLimiter, errorLearningRoutes);
app.use("/error-learning", require("./src/routes/autoTune.routes"));

// Admin-only: Fetch logs viewer
app.use("/logs", authMiddleware, csrfMiddleware, apiLimiter, requireAdmin, createAuditLogMiddleware({ resource: 'logs' }), logsRoutes);

// Admin-only: WebAPI BPS health probe + dashboard
app.use("/webapi-bps", authMiddleware, csrfMiddleware, apiLimiter, requireAdmin, createAuditLogMiddleware({ resource: 'webapi-bps' }), webapiBpsRoutes);

// Admin-only: Peta Tematik (choropleth map data)
app.use("/peta-tematik", authMiddleware, apiLimiter, requireAdmin, createAuditLogMiddleware({ resource: 'peta-tematik' }), require("./src/routes/peta-tematik.routes"));

// Global error handler
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
    const status = err.status || 500;
    const isProd = process.env.NODE_ENV === "production";
    const payload = {
        error: {
            message: err.message || "Internal Server Error",
            code: err.code || "ERR_GENERIC",
        },
    };
    if (!isProd && err.stack) payload.error.stack = err.stack;
    res.status(status).json(payload);
});

// ===========================
module.exports = app;
