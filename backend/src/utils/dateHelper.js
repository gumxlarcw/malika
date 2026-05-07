/**
 * Date/Time utilities for consistent date handling
 * Replaces mix of new Date(), Date.now(), now() throughout codebase
 */

const DEFAULT_TIMEZONE = process.env.APP_TIMEZONE || 'Asia/Jayapura';

/**
 * Get current date as Date object
 * @returns {Date}
 */
function now() {
  return new Date();
}

/**
 * Get current date as ISO string (e.g., "2026-01-23T10:30:00.000Z")
 * @returns {string}
 */
function nowISO() {
  return new Date().toISOString();
}

/**
 * Get current timestamp in milliseconds (Unix epoch)
 * @returns {number}
 */
function nowUnix() {
  return Date.now();
}

/**
 * Get current timestamp in seconds (Unix epoch)
 * @returns {number}
 */
function nowUnixSeconds() {
  return Math.floor(Date.now() / 1000);
}

/**
 * Get current date in MySQL datetime format (e.g., "2026-01-23 10:30:00")
 * @returns {string}
 */
function nowMySQL() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

/**
 * Get date N days ago
 * @param {number} days - Number of days to subtract
 * @returns {Date}
 */
function daysAgo(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d;
}

/**
 * Get date N hours ago
 * @param {number} hours - Number of hours to subtract
 * @returns {Date}
 */
function hoursAgo(hours) {
  return new Date(Date.now() - hours * 60 * 60 * 1000);
}

/**
 * Get date N minutes ago
 * @param {number} minutes - Number of minutes to subtract
 * @returns {Date}
 */
function minutesAgo(minutes) {
  return new Date(Date.now() - minutes * 60 * 1000);
}

/**
 * Check if date is within the last N hours
 * @param {Date|string|number} date - Date to check
 * @param {number} hours - Number of hours
 * @returns {boolean}
 */
function isWithinHours(date, hours) {
  const d = new Date(date);
  const cutoff = hoursAgo(hours);
  return d >= cutoff;
}

/**
 * Format date for display (Indonesian locale)
 * @param {Date|string} date - Date to format
 * @returns {string} e.g., "23 Januari 2026"
 */
function formatDateID(date) {
  const d = new Date(date);
  return d.toLocaleDateString('id-ID', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: DEFAULT_TIMEZONE,
  });
}

/**
 * Format datetime for display (Indonesian locale)
 * @param {Date|string} date - Date to format
 * @returns {string} e.g., "23 Januari 2026, 10:30"
 */
function formatDateTimeID(date) {
  const d = new Date(date);
  return d.toLocaleDateString('id-ID', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: DEFAULT_TIMEZONE,
  });
}

const MONTH_NAMES_ID = [
  'januari',
  'februari',
  'maret',
  'april',
  'mei',
  'juni',
  'juli',
  'agustus',
  'september',
  'oktober',
  'november',
  'desember',
];

const MONTH_ALIASES = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  mei: 5,
  jun: 6,
  jul: 7,
  agu: 8,
  ags: 8,
  sep: 9,
  okt: 10,
  nov: 11,
  des: 12,
};

function getMonthFromName(name) {
  if (!name) return null;
  const key = String(name || '').trim().toLowerCase();
  const fullIdx = MONTH_NAMES_ID.indexOf(key);
  if (fullIdx >= 0) return fullIdx + 1;
  const short = key.slice(0, 3);
  return MONTH_ALIASES[short] || null;
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

/**
 * Format date with a simple token format or Indonesian locale.
 * Supported tokens: YYYY, MM, DD, HH, mm, ss
 * @param {Date|string|number} date
 * @param {string} [format] - e.g., "YYYY-MM-DD", "DD/MM/YYYY", "id"
 * @returns {string}
 */
function formatDate(date, format = 'id') {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return '';

  if (format === 'id' || format === 'id-ID' || format === 'long') {
    return formatDateID(d);
  }

  const map = {
    YYYY: String(d.getFullYear()),
    MM: pad2(d.getMonth() + 1),
    DD: pad2(d.getDate()),
    HH: pad2(d.getHours()),
    mm: pad2(d.getMinutes()),
    ss: pad2(d.getSeconds()),
  };

  return String(format)
    .replace(/YYYY/g, map.YYYY)
    .replace(/MM/g, map.MM)
    .replace(/DD/g, map.DD)
    .replace(/HH/g, map.HH)
    .replace(/mm/g, map.mm)
    .replace(/ss/g, map.ss);
}

/**
 * Parse common Indonesian/ISO date strings into Date.
 * @param {string|Date|number} input
 * @returns {Date|null}
 */
function parseDate(input) {
  if (input instanceof Date) return input;
  if (input === null || input === undefined) return null;

  if (typeof input === 'number') {
    const ts = input < 1e12 ? input * 1000 : input;
    const d = new Date(ts);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const raw = String(input || '').trim();
  if (!raw) return null;

  const isoMatch = raw.match(/^\s*(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})\s*$/);
  if (isoMatch) {
    const [, y, m, d] = isoMatch;
    return new Date(Number(y), Number(m) - 1, Number(d));
  }

  const altMatch = raw.match(/^\s*(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})\s*$/);
  if (altMatch) {
    const [, d, m, y] = altMatch;
    return new Date(Number(y), Number(m) - 1, Number(d));
  }

  const namedMatch = raw.match(/^\s*(\d{1,2})\s+([a-zA-Z]+)\s+(\d{4})\s*$/i);
  if (namedMatch) {
    const [, d, mName, y] = namedMatch;
    const m = getMonthFromName(mName);
    if (!m) return null;
    return new Date(Number(y), m - 1, Number(d));
  }

  const monthYearMatch = raw.match(/^\s*([a-zA-Z]+)\s+(\d{4})\s*$/i);
  if (monthYearMatch) {
    const [, mName, y] = monthYearMatch;
    const m = getMonthFromName(mName);
    if (!m) return null;
    return new Date(Number(y), m - 1, 1);
  }

  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Get quarter number (1-4)
 * @param {Date|string|number} date
 * @returns {number|null}
 */
function getQuarter(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  return Math.floor(d.getMonth() / 3) + 1;
}

/**
 * Get semester number (1-2)
 * @param {Date|string|number} date
 * @returns {number|null}
 */
function getSemester(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  return d.getMonth() < 6 ? 1 : 2;
}

/**
 * Get period string for date
 * @param {Date|string|number} date
 * @param {'monthly'|'quarterly'|'semesterly'|'yearly'} type
 * @returns {string}
 */
function getPeriodString(date, type = 'monthly') {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return '';

  const year = d.getFullYear();
  if (type === 'yearly') return String(year);
  if (type === 'monthly') return `${year}-${pad2(d.getMonth() + 1)}`;
  if (type === 'quarterly') return `${year}-Q${getQuarter(d)}`;
  if (type === 'semesterly') return `${year}-S${getSemester(d)}`;

  return `${year}-${pad2(d.getMonth() + 1)}`;
}

function parsePeriodString(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;

  const yearOnly = raw.match(/^(\d{4})$/);
  if (yearOnly) {
    const year = Number(yearOnly[1]);
    return { year, month: 12 };
  }

  const monthly = raw.match(/^(\d{4})[-]?([01]\d)$/);
  if (monthly) {
    const year = Number(monthly[1]);
    const month = Number(monthly[2]);
    return { year, month };
  }

  const quarterly = raw.match(/^(\d{4})-?Q([1-4])$/i);
  if (quarterly) {
    const year = Number(quarterly[1]);
    const q = Number(quarterly[2]);
    return { year, month: q * 3 };
  }

  const semesterly = raw.match(/^(\d{4})-?S([12])$/i);
  if (semesterly) {
    const year = Number(semesterly[1]);
    const s = Number(semesterly[2]);
    return { year, month: s * 6 };
  }

  return null;
}

/**
 * Compare two period strings (YYYY, YYYY-MM, YYYY-Qn, YYYY-Sn)
 * @returns {-1|0|1}
 */
function comparePeriods(a, b) {
  const pa = parsePeriodString(a);
  const pb = parsePeriodString(b);
  if (!pa && !pb) return 0;
  if (!pa) return -1;
  if (!pb) return 1;

  if (pa.year !== pb.year) return pa.year < pb.year ? -1 : 1;
  if (pa.month !== pb.month) return pa.month < pb.month ? -1 : 1;
  return 0;
}

module.exports = {
  now,
  nowISO,
  nowUnix,
  nowUnixSeconds,
  nowMySQL,
  daysAgo,
  hoursAgo,
  minutesAgo,
  isWithinHours,
  formatDateID,
  formatDateTimeID,
  formatDate,
  parseDate,
  getQuarter,
  getSemester,
  getPeriodString,
  comparePeriods,
};
