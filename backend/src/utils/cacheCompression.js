const zlib = require('zlib');

const COMPRESSION_PREFIX = 'gz:';
const DEFAULT_THRESHOLD = 100 * 1024; // 100KB

function getCompressionThreshold() {
  const raw = Number.parseInt(String(process.env.CACHE_COMPRESSION_THRESHOLD || ''), 10);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_THRESHOLD;
}

function encodeProcessedJsonText(jsonText) {
  const text = String(jsonText || '');
  if (!text) return { text: '', compressed: false };

  const threshold = getCompressionThreshold();
  if (text.length < threshold) return { text, compressed: false };

  const deflated = zlib.deflateSync(text);
  const encoded = deflated.toString('base64');
  return { text: `${COMPRESSION_PREFIX}${encoded}`, compressed: true };
}

function decodeProcessedJsonText(value) {
  if (!value) return '';
  const text = String(value);
  if (!text.startsWith(COMPRESSION_PREFIX)) return text;

  const encoded = text.slice(COMPRESSION_PREFIX.length);
  const buffer = Buffer.from(encoded, 'base64');
  return zlib.inflateSync(buffer).toString('utf8');
}

function parseProcessedJson(value) {
  if (!value) return null;
  try {
    const decoded = decodeProcessedJsonText(value);
    return JSON.parse(decoded);
  } catch {
    return null;
  }
}

module.exports = {
  encodeProcessedJsonText,
  decodeProcessedJsonText,
  parseProcessedJson,
};
