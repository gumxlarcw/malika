const AppSetting = require('../../models/AppSetting.model');

function safeJsonStringify(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

function safeJsonParse(text) {
  if (text == null) return null;
  try {
    return JSON.parse(String(text));
  } catch {
    return null;
  }
}

async function getJson(key) {
  const row = await AppSetting.findByPk(String(key));
  if (!row) return null;
  return safeJsonParse(row.value_json);
}

async function setJson(key, value) {
  const now = new Date();
  const valueJson = value == null ? null : safeJsonStringify(value);

  const [row, created] = await AppSetting.findOrCreate({
    where: { key: String(key) },
    defaults: {
      key: String(key),
      value_json: valueJson,
      updated_at: now,
    },
  });

  if (!created) {
    row.value_json = valueJson;
    row.updated_at = now;
    await row.save();
  }

  return { key: row.key, value: safeJsonParse(row.value_json), updated_at: row.updated_at };
}

module.exports = {
  getJson,
  setJson,
};
