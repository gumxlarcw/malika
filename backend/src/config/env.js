require("dotenv").config();

function required(name) {
    const v = process.env[name];
    if (!v || String(v).trim() === "") {
        throw new Error(`Missing required env var: ${name}`);
    }
    return v;
}

const isProd = process.env.NODE_ENV === "production";

function get(name, fallback) {
    const v = process.env[name];
    if (v && String(v).trim() !== "") return v;
    if (!isProd && typeof fallback !== "undefined") return fallback;
    return required(name);
}

const config = {
    port: process.env.PORT || 5000,
    db: {
        name: get("DB_NAME", "project_data_strategis"),
        user: get("DB_USER", "root"),
        pass: get("DB_PASS", ""),
        host: get("DB_HOST", "localhost"),
    },
    // JWT_SECRET wajib di-set. Di dev, boleh pakai fallback untuk kemudahan.
    // Di production, HARUS eksplisit via env var.
    jwtSecret: get("JWT_SECRET", isProd ? undefined : "secret-dev-local-only"),
};

module.exports = config;
