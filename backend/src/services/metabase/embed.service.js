const jwt = require("jsonwebtoken");

function buildMetabaseDashboardEmbedUrl({
  siteUrl,
  secretKey,
  dashboardId,
  params,
  expSeconds,
  bordered,
  titled,
}) {
  const payload = {
    resource: { dashboard: dashboardId },
    params: params || {},
    exp: Math.round(Date.now() / 1000) + expSeconds,
  };

  const token = jwt.sign(payload, secretKey);

  const hash = new URLSearchParams({
    bordered: String(Boolean(bordered)),
    titled: String(Boolean(titled)),
  }).toString();

  return `${siteUrl}/embed/dashboard/${token}#${hash}`;
}

function getMetabaseConfig() {
  const siteUrl = String(process.env.METABASE_SITE_URL || "https://metabase.bpsmalut.com").replace(/\/$/, "");
  const secretKey = process.env.METABASE_SECRET_KEY;

  if (!secretKey) {
    const err = new Error("METABASE_SECRET_KEY is not configured");
    err.status = 500;
    throw err;
  }

  const expSecondsRaw = process.env.METABASE_EMBED_EXP_SECONDS;
  const expSeconds = expSecondsRaw ? Number(expSecondsRaw) : 10 * 60;

  return {
    siteUrl,
    secretKey,
    expSeconds: Number.isFinite(expSeconds) && expSeconds > 0 ? expSeconds : 10 * 60,
  };
}

async function getDashboardEmbedUrl({ dashboardId, params, bordered, titled }) {
  const { siteUrl, secretKey, expSeconds } = getMetabaseConfig();

  return buildMetabaseDashboardEmbedUrl({
    siteUrl,
    secretKey,
    dashboardId,
    params,
    expSeconds,
    bordered,
    titled,
  });
}

module.exports = {
  getDashboardEmbedUrl,
};
