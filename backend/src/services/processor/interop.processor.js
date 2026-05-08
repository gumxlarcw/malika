module.exports = function processInterop(api) {
    try {
        const payload = api.data[1];
        const colMeta = payload.kolom;

        const columnIds = Object.keys(colMeta);
        const columns = ["Wilayah", ...columnIds.map(id => colMeta[id].nama_variabel)];

        const normalizeValue = (val) => {
            // null, undefined, empty string → null
            if (val === null || val === undefined || val === "") {
                return null;
            }

            // Jika string dan berisi titik → coba parse angka
            if (typeof val === "string") {
                const cleaned = val.replace(/\./g, "");

                // Jika hasil cleaned adalah angka valid → parse
                if (!isNaN(cleaned)) {
                    return Number(cleaned);
                }

                // Jika bukan angka → kembalikan string original apa adanya
                return val;
            }

            // numeric langsung return
            if (typeof val === "number") {
                return val;
            }

            return val;
        };

        const rows = payload.data.map(row => {
            const obj = { Wilayah: row.label };
            const value_codes = {};

            for (const colId of columnIds) {
                let rawValue = null;
                let rawCode = null;

                // Format 1: row.variables[colId]
                if (row.variables && row.variables[colId]) {
                    rawValue = row.variables[colId].value_raw;
                    rawCode = row.variables[colId].value_code;
                }
                // Format 2: row[colId]
                else if (row[colId]) {
                    rawValue = row[colId].value_raw || row[colId].value;
                    rawCode = row[colId].value_code;
                }

                const metricKey = colMeta[colId].nama_variabel;
                obj[metricKey] = normalizeValue(rawValue);
                if (rawCode != null && rawCode !== "") {
                    value_codes[metricKey] = String(rawCode);
                }
            }

            if (Object.keys(value_codes).length > 0) {
                obj.value_codes = value_codes;
            }

            return obj;
        });

        return {
            source: payload.judul_tabel,
            period: payload.tahun_data,
            columns,
            data: rows,
            last_update: payload.table_updated || api.last_update || null
        };

    } catch (err) {
        return { error: "Interop parse failed", details: err.message };
    }
};
