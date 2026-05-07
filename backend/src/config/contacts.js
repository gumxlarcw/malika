/**
 * External contact configuration
 * Centralizes hardcoded URLs and contact info
 */

/**
 * WhatsApp contact for MALIKA assistant
 */
const WHATSAPP = {
  number: '+62 851-7676-4422',
  // wa.me link without the + sign
  link: 'https://wa.me/6285176764422',
  // Display name
  name: 'MALIKA Admin',
  // Business hours (for reference)
  hours: '08:00 - 16:00 WIT',
};

/**
 * BPS (Badan Pusat Statistik) API endpoints
 */
const BPS_API = {
  baseUrl: 'https://webapi.bps.go.id/v1',
  malukuUtaraId: '82',
};

/**
 * Application URLs
 */
const APP_URLS = {
  frontend: 'https://malika.bpsmalut.com',
  backend: 'https://api-malika.bpsmalut.com',
  admin: 'https://api-malika.bpsmalut.com/backend',
};

/**
 * Format WhatsApp message link
 * @param {string} message - Pre-filled message text
 * @returns {string} Full wa.me URL with message
 */
function getWhatsAppLink(message = '') {
  const encodedMsg = encodeURIComponent(message);
  return `${WHATSAPP.link}?text=${encodedMsg}`;
}

/**
 * Format WhatsApp link for chat follow-up
 * @param {string} topic - The topic user was asking about
 * @returns {string}
 */
function getWhatsAppFollowUpLink(topic = '') {
  const message = topic
    ? `Halo, saya ingin menanyakan lebih lanjut tentang: ${topic}`
    : 'Halo, saya ingin menanyakan data statistik.';
  return getWhatsAppLink(message);
}

module.exports = {
  WHATSAPP,
  BPS_API,
  APP_URLS,
  getWhatsAppLink,
  getWhatsAppFollowUpLink,
};
