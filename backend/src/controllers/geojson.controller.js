const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function getBackendGeojsonDir() {
  // __dirname: backend/src/controllers
  return path.join(__dirname, '..', '..', 'public', 'geojson');
}

function getLegacyGeojsonDir() {
  // Legacy bug: wrote to repo-root public/geojson instead of backend/public/geojson
  // backend/src/controllers -> backend -> repo root
  return path.join(__dirname, '..', '..', '..', 'public', 'geojson');
}

async function moveFileSafe(fromPath, toPath) {
  try {
    await fs.promises.rename(fromPath, toPath);
  } catch (e) {
    // Cross-device rename fallback
    if (e && (e.code === 'EXDEV' || e.code === 'EPERM')) {
      await fs.promises.copyFile(fromPath, toPath);
      await fs.promises.unlink(fromPath);
      return;
    }
    throw e;
  }
}

async function migrateLegacyGeojsonIfAny() {
  const legacyDir = getLegacyGeojsonDir();
  const dir = getBackendGeojsonDir();

  // If legacy dir doesn't exist, nothing to do.
  try {
    await fs.promises.access(legacyDir, fs.constants.F_OK);
  } catch {
    return;
  }

  await fs.promises.mkdir(dir, { recursive: true });

  let entries;
  try {
    entries = await fs.promises.readdir(legacyDir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const e of entries) {
    if (!e.isFile()) continue;
    const name = e.name;
    const lower = name.toLowerCase();
    if (!(lower.endsWith('.geojson') || lower.endsWith('.json'))) continue;

    const src = path.join(legacyDir, name);
    let dst = path.join(dir, name);
    try {
      await fs.promises.access(dst, fs.constants.F_OK);
      // Collision: append stable suffix
      const ext = path.extname(name) || '.geojson';
      const stem = name.slice(0, name.length - ext.length);
      const hash = crypto.createHash('sha1').update(src).digest('hex').slice(0, 8);
      dst = path.join(dir, `${stem}_migrated_${hash}${ext}`);
    } catch {
      // dst doesn't exist
    }

    try {
      await moveFileSafe(src, dst);
    } catch {
      // best-effort migration
    }
  }
}

function formatBytes(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n < 0) return '-';
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 10 ? 0 : 1)} ${units[i]}`;
}

function safeBaseName(input) {
  const raw = String(input || '').trim();
  const base = path.basename(raw);
  // Keep it simple and URL-safe.
  const cleaned = base
    .replace(/\s+/g, '_')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^\.+/, '')
    .slice(0, 80);
  return cleaned || `geojson_${Date.now()}.geojson`;
}

function ensureGeojsonExt(name) {
  const lower = String(name).toLowerCase();
  if (lower.endsWith('.geojson')) return name;
  if (lower.endsWith('.json')) return name;
  return `${name}.geojson`;
}

function isLikelyGeoJson(obj) {
  if (!obj || typeof obj !== 'object') return false;
  const t = obj.type;
  // Accept common GeoJSON top-level types.
  return (
    t === 'FeatureCollection' ||
    t === 'Feature' ||
    t === 'GeometryCollection' ||
    t === 'Point' ||
    t === 'MultiPoint' ||
    t === 'LineString' ||
    t === 'MultiLineString' ||
    t === 'Polygon' ||
    t === 'MultiPolygon'
  );
}

async function resolveGeojsonPathForWrite(filename) {
  await migrateLegacyGeojsonIfAny();

  const name = path.basename(String(filename || '').trim());
  if (!name || name !== String(filename || '').trim()) {
    const err = new Error('filename tidak valid');
    err.status = 400;
    throw err;
  }
  if (name.includes('..') || name.includes('/') || name.includes('\\') || name.includes('\0')) {
    const err = new Error('filename tidak valid');
    err.status = 400;
    throw err;
  }

  const lower = name.toLowerCase();
  if (!(lower.endsWith('.geojson') || lower.endsWith('.json'))) {
    const err = new Error('Hanya mendukung .geojson/.json');
    err.status = 400;
    throw err;
  }

  const dir = getBackendGeojsonDir();
  await fs.promises.mkdir(dir, { recursive: true });
  const primary = path.join(dir, name);
  const legacy = path.join(getLegacyGeojsonDir(), name);

  try {
    await fs.promises.access(primary, fs.constants.F_OK);
    return { name, path: primary };
  } catch {
    // ignore
  }

  // If legacy exists, move it into the served dir so subsequent public access works.
  try {
    await fs.promises.access(legacy, fs.constants.F_OK);
    await moveFileSafe(legacy, primary);
    return { name, path: primary };
  } catch {
    const err = new Error('File tidak ditemukan');
    err.status = 404;
    throw err;
  }
}

async function resolveGeojsonPathForRead(filename) {
  const raw = String(filename || '').trim();
  const name = path.basename(raw);
  if (!name || name !== raw || name.includes('..') || name.includes('/') || name.includes('\\') || name.includes('\0')) {
    const err = new Error('filename tidak valid');
    err.status = 400;
    throw err;
  }
  const lower = name.toLowerCase();
  if (!(lower.endsWith('.geojson') || lower.endsWith('.json'))) {
    const err = new Error('Hanya mendukung .geojson/.json');
    err.status = 400;
    throw err;
  }

  const primary = path.join(getBackendGeojsonDir(), name);
  const legacy = path.join(getLegacyGeojsonDir(), name);
  try {
    await fs.promises.access(primary, fs.constants.F_OK);
    return { name, path: primary };
  } catch {
    // ignore
  }
  try {
    await fs.promises.access(legacy, fs.constants.F_OK);
    return { name, path: legacy };
  } catch {
    const err = new Error('File tidak ditemukan');
    err.status = 404;
    throw err;
  }
}

async function uploadGeojson(req, res) {
  const file = req.file;
  if (!file) {
    const err = new Error('File geojson wajib diupload (field: file)');
    err.status = 400;
    throw err;
  }

  const requestedNameRaw = String(req.body?.filename || req.body?.name || '').trim();
  const overwriteRaw = String(req.body?.overwrite || '').trim().toLowerCase();
  const overwrite = overwriteRaw === '1' || overwriteRaw === 'true' || overwriteRaw === 'yes' || overwriteRaw === 'on';

  const original = file.originalname || 'upload.geojson';
  let filename = requestedNameRaw ? ensureGeojsonExt(safeBaseName(requestedNameRaw)) : ensureGeojsonExt(safeBaseName(original));

  const tempPath = file.path;
  if (!tempPath) {
    const err = new Error('Upload gagal: file path tidak tersedia');
    err.status = 500;
    throw err;
  }

  const cleanupTemp = async () => {
    try {
      await fs.promises.unlink(tempPath);
    } catch {
      // best-effort
    }
  };

  // Validate JSON body.
  let parsed;
  try {
    const text = await fs.promises.readFile(tempPath, 'utf8');
    parsed = JSON.parse(text);
  } catch {
    await cleanupTemp();
    const err = new Error('File bukan JSON yang valid');
    err.status = 400;
    throw err;
  }

  if (!isLikelyGeoJson(parsed)) {
    await cleanupTemp();
    const err = new Error('JSON valid, tapi tidak terlihat seperti GeoJSON (field type tidak dikenali)');
    err.status = 400;
    throw err;
  }

  await migrateLegacyGeojsonIfAny();

  const dir = getBackendGeojsonDir();
  await fs.promises.mkdir(dir, { recursive: true });

  const target = (name) => path.join(dir, name);
  const exists = async (p) => {
    try {
      await fs.promises.access(p, fs.constants.F_OK);
      return true;
    } catch {
      return false;
    }
  };

  if (await exists(target(filename))) {
    if (!overwrite) {
      const buf = await fs.promises.readFile(tempPath);
      const hash = crypto.createHash('sha1').update(buf).digest('hex').slice(0, 8);
      const ext = path.extname(filename) || '.geojson';
      const stem = filename.slice(0, filename.length - ext.length);
      filename = `${stem}_${hash}${ext}`;
    }
  }

  // Write minified JSON to reduce file size; map consumers can still parse it.
  const finalPath = target(filename);
  try {
    await fs.promises.writeFile(finalPath, JSON.stringify(parsed), 'utf8');
  } finally {
    await cleanupTemp();
  }

  const url = `/geojson/${encodeURIComponent(filename)}`;
  res.json({ ok: true, filename, url, size_bytes: file.size || null });
}

async function listGeojson(req, res) {
  await migrateLegacyGeojsonIfAny();

  const dir = getBackendGeojsonDir();
  await fs.promises.mkdir(dir, { recursive: true });

  const entries = await fs.promises.readdir(dir, { withFileTypes: true });
  const files = [];

  for (const e of entries) {
    if (!e.isFile()) continue;
    const name = e.name;
    const lower = name.toLowerCase();
    if (!(lower.endsWith('.geojson') || lower.endsWith('.json'))) continue;

    const full = path.join(dir, name);
    try {
      const st = await fs.promises.stat(full);
      files.push({
        filename: name,
        url: `/geojson/${encodeURIComponent(name)}`,
        size_bytes: st.size,
        size_human: formatBytes(st.size),
        updated_at: st.mtime ? st.mtime.toISOString() : null,
      });
    } catch {
      // skip unreadable entries
    }
  }

  files.sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
  res.json({ ok: true, items: files });
}

async function deleteGeojson(req, res) {
  const raw = String(req.params?.filename || '').trim();
  if (!raw) {
    const err = new Error('filename wajib');
    err.status = 400;
    throw err;
  }

  // Prevent path traversal.
  const name = path.basename(raw);
  if (name !== raw || name.includes('..') || name.includes('/') || name.includes('\\') || name.includes('\0')) {
    const err = new Error('filename tidak valid');
    err.status = 400;
    throw err;
  }

  const lower = name.toLowerCase();
  if (!(lower.endsWith('.geojson') || lower.endsWith('.json'))) {
    const err = new Error('Hanya boleh hapus .geojson/.json');
    err.status = 400;
    throw err;
  }

  await migrateLegacyGeojsonIfAny();

  const dir = getBackendGeojsonDir();
  const full = path.join(dir, name);

  try {
    await fs.promises.unlink(full);
  } catch (e) {
    if (e && (e.code === 'ENOENT' || e.code === 'ENOTDIR')) {
      const err = new Error('File tidak ditemukan');
      err.status = 404;
      throw err;
    }
    throw e;
  }

  res.json({ ok: true, filename: name });
}

async function serveGeojsonPublic(req, res) {
  const raw = String(req.params?.filename || '').trim();
  if (!raw) {
    const err = new Error('Not found');
    err.status = 404;
    throw err;
  }

  // Prevent path traversal.
  const name = path.basename(raw);
  if (name !== raw || name.includes('..') || name.includes('/') || name.includes('\\') || name.includes('\0')) {
    const err = new Error('Not found');
    err.status = 404;
    throw err;
  }

  const lower = name.toLowerCase();
  if (!(lower.endsWith('.geojson') || lower.endsWith('.json'))) {
    const err = new Error('Not found');
    err.status = 404;
    throw err;
  }

  const primary = path.join(getBackendGeojsonDir(), name);
  const legacy = path.join(getLegacyGeojsonDir(), name);

  const pickExisting = async () => {
    try {
      await fs.promises.access(primary, fs.constants.F_OK);
      return primary;
    } catch {
      // ignore
    }
    try {
      await fs.promises.access(legacy, fs.constants.F_OK);
      return legacy;
    } catch {
      // ignore
    }
    return null;
  };

  const filePath = await pickExisting();
  if (!filePath) {
    const err = new Error('Not found');
    err.status = 404;
    throw err;
  }

  // Content type hint (helps browsers & map consumers)
  const contentType = lower.endsWith('.geojson') ? 'application/geo+json; charset=utf-8' : 'application/json; charset=utf-8';
  res.setHeader('Content-Type', contentType);
  res.setHeader('Cache-Control', 'public, max-age=300');

  return res.sendFile(filePath);
}

// Admin raw read (for preview + editing UI)
async function getGeojsonAdmin(req, res) {
  const { path: filePath, name } = await resolveGeojsonPathForRead(req.params?.filename);
  let parsed;
  try {
    const text = await fs.promises.readFile(filePath, 'utf8');
    parsed = JSON.parse(text);
  } catch {
    const err = new Error('Gagal membaca file (JSON tidak valid)');
    err.status = 500;
    throw err;
  }
  res.json({ ok: true, filename: name, geojson: parsed });
}

// Admin bulk property update: apply mapping idKey -> labelKey and save
async function updateGeojsonPropertiesAdmin(req, res) {
  const { path: filePath, name } = await resolveGeojsonPathForWrite(req.params?.filename);

  const idKey = String(req.body?.idKey || '').trim();
  const labelKey = String(req.body?.labelKey || '').trim();
  const updatesRaw = req.body?.updates;

  if (!idKey || !labelKey) {
    const err = new Error('idKey dan labelKey wajib');
    err.status = 400;
    throw err;
  }
  if (!Array.isArray(updatesRaw) || updatesRaw.length === 0) {
    const err = new Error('updates wajib berupa array dan tidak boleh kosong');
    err.status = 400;
    throw err;
  }

  const mapping = new Map();
  for (const u of updatesRaw) {
    const id = u && typeof u === 'object' ? String(u.id ?? '').trim() : '';
    const label = u && typeof u === 'object' ? String(u.label ?? '').trim() : '';
    if (!id) continue;
    mapping.set(id, label);
  }
  if (mapping.size === 0) {
    const err = new Error('updates tidak berisi id yang valid');
    err.status = 400;
    throw err;
  }

  let parsed;
  try {
    const text = await fs.promises.readFile(filePath, 'utf8');
    parsed = JSON.parse(text);
  } catch {
    const err = new Error('Gagal membaca file (JSON tidak valid)');
    err.status = 500;
    throw err;
  }

  if (!isLikelyGeoJson(parsed)) {
    const err = new Error('File bukan GeoJSON yang valid');
    err.status = 400;
    throw err;
  }
  if (parsed.type !== 'FeatureCollection' || !Array.isArray(parsed.features)) {
    const err = new Error('Edit properti hanya didukung untuk GeoJSON type=FeatureCollection');
    err.status = 400;
    throw err;
  }

  let changed = 0;
  for (const f of parsed.features) {
    if (!f || typeof f !== 'object') continue;
    const props = f.properties;
    if (!props || typeof props !== 'object') continue;
    const currentId = props[idKey];
    if (currentId === null || typeof currentId === 'undefined') continue;
    const key = String(currentId).trim();
    if (!mapping.has(key)) continue;
    const nextLabel = mapping.get(key);
    if (props[labelKey] !== nextLabel) {
      props[labelKey] = nextLabel;
      changed++;
    }
  }

  await fs.promises.writeFile(filePath, JSON.stringify(parsed), 'utf8');

  res.json({
    ok: true,
    filename: name,
    changed_features: changed,
    total_features: parsed.features.length,
    url: `/geojson/${encodeURIComponent(name)}`,
  });
}

module.exports = {
  uploadGeojson,
  listGeojson,
  deleteGeojson,
  serveGeojsonPublic,
  getGeojsonAdmin,
  updateGeojsonPropertiesAdmin,
};
