'use strict';

/**
 * Read and write the two editorial settings behind the dashboard:
 * which indicators lead it, and what order the category sections appear in.
 *
 * Both live in `app_settings`, so there is no schema to migrate and the values
 * are visible to anyone reading the table.
 */

const appSettings = require('../settings/appSettings.service');
const dashboardService = require('./dashboard.service');

const MAX_HEADLINE = 12;

function normaliseHeadline(value) {
  if (!Array.isArray(value)) throw new Error('Invalid headline');
  if (value.length > MAX_HEADLINE) throw new Error('Invalid headline');
  const out = [];
  for (const raw of value) {
    const n = Number(raw);
    if (!Number.isInteger(n) || n <= 0 || n > 99999) throw new Error('Invalid headline');
    if (!out.includes(n)) out.push(n);
  }
  return out;
}

function normaliseCategoryOrder(value) {
  if (!Array.isArray(value)) throw new Error('Invalid categoryOrder');
  const out = [];
  for (const raw of value) {
    if (typeof raw !== 'string') throw new Error('Invalid categoryOrder');
    const name = raw.trim();
    if (name && !out.includes(name)) out.push(name);
  }
  return out;
}

async function getCuration() {
  const [headline, categoryOrder, summary] = await Promise.all([
    appSettings.getJson(dashboardService.HEADLINE_SETTING_KEY),
    appSettings.getJson(dashboardService.CATEGORY_ORDER_SETTING_KEY),
    dashboardService.getSummary(),
  ]);

  // Only what the picker renders. The full summary is ~194 KB and the admin page
  // has no use for values, trends or units.
  const candidates = summary.categories.flatMap((c) =>
    c.indicators.map((i) => ({
      sourceId: i.sourceId,
      name: i.name,
      category: i.category,
      shape: i.shape,
    }))
  );

  return {
    headline: Array.isArray(headline) ? headline : [],
    categoryOrder: Array.isArray(categoryOrder) ? categoryOrder : [],
    categories: summary.categories.map((c) => c.name),
    candidates,
  };
}

async function saveCuration({ headline, categoryOrder }) {
  const cleanHeadline = normaliseHeadline(headline);
  const cleanOrder = normaliseCategoryOrder(categoryOrder);

  await appSettings.setJson(dashboardService.HEADLINE_SETTING_KEY, cleanHeadline);
  await appSettings.setJson(dashboardService.CATEGORY_ORDER_SETTING_KEY, cleanOrder);

  return { headline: cleanHeadline, categoryOrder: cleanOrder };
}

module.exports = { getCuration, saveCuration, MAX_HEADLINE };
