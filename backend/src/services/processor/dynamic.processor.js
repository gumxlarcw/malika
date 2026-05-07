const { decodeKeyUsingMetadata } = require("../../utils/parser");

module.exports = function processDynamic(api) {
    const vervar = Array.isArray(api?.vervar) ? api.vervar : [];
    const turvar = Array.isArray(api?.turvar) ? api.turvar : [];
    const datacontent = api?.datacontent && typeof api.datacontent === 'object' ? api.datacontent : {};

    const vervarLabel = api.labelvervar || "Vervar"; // fallback aman

    // apakah turvar hanya 1 dan val = "0" (Tidak ada)
    const isSingleTurvar = (turvar.length === 1 && Number(turvar[0].val) === 0);

    const turtahun = Array.isArray(api?.turtahun) ? api.turtahun : [];
    const looksQuarterly = turtahun.some((t) => /triwulan/i.test(String(t?.label || ''))) ||
        turtahun.some((t) => /tahunan/i.test(String(t?.label || '')));

    // If fetchByTh attached context, use it to filter to a single tahun value.
    const requestedThId = api && typeof api === 'object' && api.__th_id != null ? String(api.__th_id) : null;

    // =========================
    // QUARTERLY (TRIWULAN) MODE
    // =========================
    if (looksQuarterly) {
        const bulans = turtahun;
        const rowsByKey = new Map();

        // Pre-create stable rows for each (turtahun, vervar)
        for (const tt of bulans) {
            const bulanLabel = String(tt?.label || '').trim();
            for (const v of vervar) {
                const dimLabel = String(v?.label || '').trim();
                const k = `${String(tt?.val)}|${String(v?.val)}`;
                rowsByKey.set(k, { Bulan: bulanLabel, [vervarLabel]: dimLabel });
            }
        }

        for (const key in datacontent) {
            const parsed = decodeKeyUsingMetadata(key, api);
            if (!parsed) continue;

            if (requestedThId && String(parsed.tahun) !== requestedThId) continue;

            const rowKey = `${String(parsed.turtahun)}|${String(parsed.vervar)}`;
            const row = rowsByKey.get(rowKey);
            if (!row) continue;

            const value = datacontent[key];

            if (isSingleTurvar) {
                row["Nilai"] = value;
            } else {
                const tur = turvar.find((t) => String(t.val) === String(parsed.turvar));
                if (tur) row[String(tur.label)] = value;
            }
        }

        const metricCols = isSingleTurvar ? ["Nilai"] : turvar.map((t) => String(t.label));
        const columns = ["Bulan", vervarLabel, ...metricCols];
        const rowsOut = Array.from(rowsByKey.values());
        for (const row of rowsOut) {
            for (const col of columns) {
                if (row[col] === undefined) row[col] = null;
            }
        }

        // Keep a reasonable default period label
        const periodLabel = requestedThId
            ? (api?.tahun || []).find((t) => String(t?.val) === requestedThId)?.label || requestedThId
            : api?.tahun?.[0]?.label || "";

        return {
            period: periodLabel,
            columns,
            data: rowsOut,
            source: api.var?.[0]?.label || "",
            last_update: api.last_update || null
        };
    }

    // =========================
    // DEFAULT (MONTHLY / SIMPLE)
    // =========================
    const columns = isSingleTurvar
        ? [vervarLabel, "Nilai"]
        : [vervarLabel, ...turvar.map(t => t.label)];

    const rows = vervar.map(v => ({ [vervarLabel]: v.label }));

    for (const key in datacontent) {
        const parsed = decodeKeyUsingMetadata(key, api);
        if (!parsed) continue;

        if (requestedThId && String(parsed.tahun) !== requestedThId) continue;

        const idx = vervar.findIndex(v => String(v.val) === String(parsed.vervar));
        if (idx === -1) continue;

        const value = datacontent[key];

        if (isSingleTurvar) {
            rows[idx]["Nilai"] = value;
        } else {
            const tur = turvar.find(t => String(t.val) === String(parsed.turvar));
            if (tur) {
                rows[idx][tur.label] = value;
            }
        }
    }

    for (const row of rows) {
        for (const col of columns) {
            if (row[col] === undefined) row[col] = null;
        }
    }

    // =========================
    // RETURN RESULT
    // =========================
    return {
        period: (requestedThId
            ? (api?.tahun || []).find((t) => String(t?.val) === requestedThId)?.label || requestedThId
            : api.tahun?.[0]?.label || ""),
        columns,
        data: rows,
        source: api.var?.[0]?.label || "",
        last_update: api.last_update || null
    };
};
