const { fetchAPI } = require('./fetch.service');

function safeString(v) {
  return typeof v === 'string' ? v.trim() : '';
}

function decodeHtmlEntities(input) {
  const str = safeString(input);
  if (!str) return '';

  // Decode a small set of common entities + numeric entities.
  return str
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
      try {
        return String.fromCodePoint(parseInt(hex, 16));
      } catch {
        return '';
      }
    })
    .replace(/&#(\d+);/g, (_, dec) => {
      try {
        return String.fromCodePoint(parseInt(dec, 10));
      } catch {
        return '';
      }
    });
}

function cleanText(input) {
  const decoded = decodeHtmlEntities(input);
  if (!decoded) return '';

  return decoded
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<\/?p\s*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/[\r\t]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function stripTrailingYear(title) {
  const t = safeString(title);
  if (!t) return '';

  // Remove trailing ", 2025" or " 2025".
  return t
    .replace(/,\s*\d{4}\s*$/g, '')
    .replace(/\s+\d{4}\s*$/g, '')
    .trim();
}

function guessTypeFromUrl(url) {
  const u = safeString(url);
  if (!u) return null;
  if (/\/v1\/api\/list\/model\/data\//i.test(u)) return 'dynamic';
  if (/\/v1\/api\/dataexim\//i.test(u)) return 'exim';
  if (/interoperabilitas|\/interop\//i.test(u)) return 'interop';
  // Pressrelease has 2 common forms:
  // - list: /v1/api/list/model/pressrelease/...
  // - view: /v1/api/view/.../model/pressrelease/...
  if (/\/v1\/api\/list\/model\/pressrelease\//i.test(u)) return 'pressrelease';
  if (/\/v1\/api\/view\/.+\/model\/pressrelease\//i.test(u)) return 'pressrelease';
  return 'static';
}

function normalizeUrlTemplate(url, type) {
  const u = safeString(url);
  if (!u) return u;

  if (type === 'dynamic') {
    // Replace th/<digits> with th/{period}
    return u.replace(/\/th\/(\d+)\b/i, '/th/{period}');
  }

  if (type === 'interop') {
    // Common patterns: /tahun/2025 or ?year=2025
    if (/\/tahun\/(\d{4})\b/i.test(u)) {
      return u.replace(/\/tahun\/(\d{4})\b/i, '/tahun/{period}');
    }
    if (/[?&]year=\d{4}\b/i.test(u)) {
      return u.replace(/([?&]year=)(\d{4})\b/i, '$1{period}');
    }
    return u;
  }

  if (type === 'exim') {
    // Common patterns: /tahun/2025 and /kodehs/72
    let out = u;
    if (/\/tahun\/(\d{4})\b/i.test(out)) {
      out = out.replace(/\/tahun\/(\d{4})\b/i, '/tahun/{period}');
    }
    if (/\/kodehs\/(\d{1,4})\b/i.test(out)) {
      out = out.replace(/\/kodehs\/(\d{1,4})\b/i, '/kodehs/{code_hs}');
    }
    return out;
  }

  if (type === 'pressrelease') {
    // Pressrelease API URL - no period template needed
    return u;
  }

  // static: no period template by default
  return u;
}

function buildDefaultNameFromUrl(url) {
  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.split('/').filter(Boolean);
    const last = parts[parts.length - 1] || parsed.hostname;
    return decodeURIComponent(last).slice(0, 150);
  } catch {
    return 'Datasource';
  }
}

async function parseDatasourceUrl({ url, type: typeOverride }) {
  const rawUrl = safeString(url);
  if (!rawUrl) {
    const err = new Error('URL wajib diisi');
    err.status = 400;
    throw err;
  }

  const detectedType = typeOverride || guessTypeFromUrl(rawUrl) || 'static';
  const apiUrlTemplate = normalizeUrlTemplate(rawUrl, detectedType);

  const suggested = {
    name: buildDefaultNameFromUrl(rawUrl),
    description: null,
    type: detectedType,
    api_url: apiUrlTemplate,
    period_key: detectedType === 'dynamic' ? 'th' : (detectedType === 'interop' || detectedType === 'exim') ? 'tahun' : null,
    auto_period: detectedType === 'dynamic' || detectedType === 'interop' || detectedType === 'exim',
    status: true,
    visible: true,
    display_order: 0,
    category: null,
  };

  const warnings = [];

  // For dynamic, fetch once to derive name/category/description.
  if (detectedType === 'dynamic') {
    try {
      const json = await fetchAPI(rawUrl, null);
      const varLabel = json?.var?.[0]?.label;
      const subjectLabel = json?.subject?.[0]?.label;
      const varDef = json?.var?.[0]?.def;

      if (typeof varLabel === 'string' && varLabel.trim()) {
        suggested.name = varLabel.trim().slice(0, 150);
      }

      // Dynamic: aliases must be blank on prefill (so admin can decide).
      suggested.aliases = '';

      if (typeof subjectLabel === 'string' && subjectLabel.trim()) {
        suggested.category = subjectLabel.trim().slice(0, 100);
      }

      // Dynamic: description should come from var.def (if empty, keep empty).
      if (typeof varDef === 'string' && varDef.trim()) {
        suggested.description = varDef.trim();
      } else {
        suggested.description = null;
      }
    } catch (e) {
      warnings.push(`Tidak bisa fetch metadata dari URL (tetap bisa disimpan): ${e?.message || String(e)}`);
    }
  }

  // For interop, fetch once to derive name/category/description.
  if (detectedType === 'interop') {
    try {
      const json = await fetchAPI(rawUrl, null);
      const dataRow = Array.isArray(json?.data) ? json.data?.[1] : null;

      const judul = dataRow?.judul_tabel;
      const mmsSubject = dataRow?.mms_subject;
      const kolom = dataRow?.kolom;

      if (typeof judul === 'string' && judul.trim()) {
        suggested.name = stripTrailingYear(cleanText(judul)).slice(0, 150) || suggested.name;
      }

      if (typeof mmsSubject === 'string' && mmsSubject.trim()) {
        suggested.category = cleanText(mmsSubject).slice(0, 100) || suggested.category;
      }

      if (kolom && typeof kolom === 'object') {
        const entries = Object.values(kolom);
        const lines = [];

        for (const entry of entries) {
          const nama = cleanText(entry?.nama_variabel);
          const definisi = cleanText(entry?.metadata_konsep_definisi);
          if (!nama || !definisi) continue;
          lines.push(`- ${nama}: ${definisi}`);
        }

        suggested.description = lines.length ? lines.join('\n') : null;
      }
    } catch (e) {
      warnings.push(`Tidak bisa fetch metadata interop dari URL (tetap bisa disimpan): ${e?.message || String(e)}`);
    }
  }

  // Ensure {period} for dynamic URLs
  if (detectedType === 'dynamic' && !suggested.api_url.includes('{period}')) {
    warnings.push('URL dynamic tidak mengandung th/{period}; pastikan segment th sudah benar.');
  }

  if (detectedType === 'exim') {
    if (!suggested.api_url.includes('{period}')) {
      warnings.push('URL exim tidak mengandung /tahun/{period}; pastikan segment tahun sudah benar.');
    }
    if (!suggested.api_url.includes('{code_hs}')) {
      warnings.push('URL exim tidak mengandung /kodehs/{code_hs}; kode HS akan dianggap fixed dari URL.');
    }
  }

  return { detectedType, suggested, warnings };
}

module.exports = { parseDatasourceUrl };
