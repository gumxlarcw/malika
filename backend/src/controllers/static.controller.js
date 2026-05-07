const DataSource = require("../models/DataSource.model");
const getSequelizeBps = require("../config/db_bps");
const { readGenericIndicatorFromBps } = require("../services/bpsRead/indicatorTableGenericRead.service");

exports.getStatic = async (req, res) => {
    try {
        const source_id = req.params.id;

        const sequelizeBps = getSequelizeBps();
        if (!sequelizeBps) {
            return res.status(503).json({
                message: "DB data_bps belum dikonfigurasi (DB_BPS_USER/DB_BPS_PASS). Endpoint ini hanya melayani data dari data_bps.",
                code: "DB_BPS_DISABLED",
            });
        }

        // Ambil config dari database
        const source = await DataSource.findByPk(source_id);
        if (!source) {
            return res.status(404).json({ message: "Source not found" });
        }

        const bpsData = await readGenericIndicatorFromBps({
            sourceId: source_id,
            period: 'static',
            sourceName: source?.name || "Data Statistik",
        });

        if (bpsData && bpsData.__disabled) {
            return res.status(503).json({
                message: "DB data_bps belum dikonfigurasi (DB_BPS_USER/DB_BPS_PASS).",
                code: "DB_BPS_DISABLED",
            });
        }

        if (!bpsData) {
            return res.status(404).json({
                message: "Data indikator belum tersedia di data_bps (belum direplikasi).",
                code: "DATA_BPS_NOT_AVAILABLE",
            });
        }

        return res.json({
            cached: true,
            data: bpsData,
        });

    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
};
