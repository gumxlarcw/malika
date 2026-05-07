const { listNotifications } = require('../services/notification/notification.service');

exports.getNotifications = async (req, res) => {
  try {
    const limit = req.query.limit;
    const offset = req.query.offset;
    const type = req.query.type ? String(req.query.type) : undefined;

    const rows = await listNotifications({ limit, offset, type });

    // Keep response stable & simple for frontend consumption
    const payload = rows.map((r) => {
      let meta = null;
      try {
        meta = r.metadata_json ? JSON.parse(r.metadata_json) : null;
      } catch {
        meta = null;
      }

      return {
        id: r.id,
        type: r.type,
        title: r.title,
        message: r.message,
        link: r.link,
        created_at: r.created_at,
        metadata: meta,
      };
    });

    res.json({ items: payload });
  } catch (err) {
    res.status(500).json({ message: err.message || String(err) });
  }
};
