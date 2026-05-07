/**
 * BRS Fetcher Service
 * Fetches BRS (Berita Resmi Statistik) from BPS API
 */

const { fetchAPI } = require('../datasource/fetch.service');

const BPS_API_BASE = 'https://webapi.bps.go.id/v1/api';
const BPS_API_KEY = process.env.BPS_API_KEY;
const DOMAIN_ID = '8200'; // Maluku Utara

/**
 * Fetch list of BRS from BPS API
 * @param {object} options
 * @param {number} options.page - Page number (1-based)
 * @param {number} options.perPage - Items per page (default 10)
 * @param {number} options.year - Filter by year (optional)
 * @returns {Promise<{items: Array, pagination: object}>}
 */
async function fetchBrsList(options = {}) {
  const { page = 1, perPage = 10, year } = options;
  
  let url = `${BPS_API_BASE}/list/model/pressrelease/domain/${DOMAIN_ID}/page/${page}/key/${BPS_API_KEY}/`;
  
  if (year) {
    url += `year/${year}/`;
  }
  
  const data = await fetchAPI(url, null, 2);
  
  // BPS API returns data in nested format: data[0] = pagination, data[1] = items array
  const pagination = data.data?.[0] || {};
  const items = data.data?.[1] || [];
  
  return {
    items: items.map(item => ({
      brs_id: item.brs_id,
      title: item.title,
      abstract: cleanHtml(item.abstract || ''),
      abstract_raw: item.abstract || '',
      release_date: item.rl_date,
      pdf_url: item.pdf,
      size: item.size,
      subject: item.subcsa || item.subj,
    })),
    pagination: {
      page: pagination.page || page,
      pages: pagination.pages || 1,
      total: pagination.total || items.length,
      perPage: pagination.per_page || perPage,
    },
  };
}

/**
 * Fetch all BRS (paginated)
 * @param {object} options
 * @param {number} options.maxPages - Maximum pages to fetch (default 100)
 * @param {number} options.year - Filter by year (optional)
 * @param {function} options.onProgress - Progress callback
 * @returns {Promise<Array>}
 */
async function fetchAllBrs(options = {}) {
  const { maxPages = 100, year, onProgress } = options;
  
  const allItems = [];
  let page = 1;
  let totalPages = 1;
  
  while (page <= totalPages && page <= maxPages) {
    const result = await fetchBrsList({ page, year });
    allItems.push(...result.items);
    
    totalPages = result.pagination.pages;
    
    if (onProgress) {
      onProgress({
        page,
        totalPages,
        itemsFetched: allItems.length,
        totalItems: result.pagination.total,
      });
    }
    
    page++;
    
    // Rate limiting
    if (page <= totalPages) {
      await sleep(100);
    }
  }
  
  return allItems;
}

/**
 * Clean HTML entities and tags from abstract
 */
function cleanHtml(html) {
  if (!html) return '';
  
  return html
    // Decode HTML entities
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    // Remove HTML tags
    .replace(/<[^>]+>/g, ' ')
    // Normalize whitespace
    .replace(/\s+/g, ' ')
    .trim();
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = {
  fetchBrsList,
  fetchAllBrs,
  cleanHtml,
};
