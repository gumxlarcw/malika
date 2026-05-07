const DataSource = require('../../models/DataSource.model');

const SYSTEM_PUBLICATION_API_URL = 'system:publication';

async function ensurePublicationSystemDatasource() {
  const existing = await DataSource.findOne({
    where: { api_url: SYSTEM_PUBLICATION_API_URL },
    order: [['id', 'ASC']],
  });

  if (existing) return existing;

  const now = new Date();
  const created = await DataSource.create({
    name: 'System: Publikasi Notifications',
    description: 'Internal datasource for publication notification snapshot storage',
    type: 'static',
    api_url: SYSTEM_PUBLICATION_API_URL,
    period_key: null,
    auto_period: false,
    status: true,
    visible: false,
    display_order: 0,
    created_at: now,
    updated_at: now,
  });

  return created;
}

module.exports = {
  ensurePublicationSystemDatasource,
  SYSTEM_PUBLICATION_API_URL,
};
