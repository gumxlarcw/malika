/**
 * Transform press release detail data menjadi standardized format
 * Input: { keyword, data, last_update }
 *   - keyword: string (e.g., "inflasi")
 *   - data: { brs_id: {...detail...}, ... }
 *   - last_update: ISO datetime
 * 
 * Output: { source, period, columns, data, last_update }
 */
module.exports = function processPressRelease({ keyword, detailsById, listById, last_update }) {
    const rows = [];
    const listMap = listById && typeof listById === "object" ? listById : {};
    const detailMap = detailsById && typeof detailsById === "object" ? detailsById : {};

    for (const brs_id in detailMap) {
        const detail = detailMap[brs_id];
        if (!detail) continue;

        const list = listMap[brs_id] || listMap[Number(brs_id)] || null;

        const row = {
            // Core
            brs_id: Number(brs_id),
            title: detail.title || list?.title || "",
            abstract: detail.abstract || list?.abstract || "",
            rl_date: detail.rl_date || list?.rl_date || "",
            updt_date: detail.updt_date ?? list?.updt_date ?? null,

            // Enrichment from list response
            subj_id: list?.subj_id ?? null,
            subj: list?.subj ?? null,
            subcsa_id: list?.subcsa_id ?? null,
            subcsa: list?.subcsa ?? "",

            // Files / metadata
            pdf: detail.pdf || list?.pdf || "",
            slide: detail.slide || list?.slide || "",
            thumbnail: detail.thumbnail || list?.thumbnail || "",
            size: detail.size || list?.size || "",
            hit: detail.hit ?? null,

            // Keep UI-friendly aliases
            pdf_url: detail.pdf || list?.pdf || "",
            slide_url: detail.slide || list?.slide || "",
            thumbnail_url: detail.thumbnail || list?.thumbnail || "",

            // Arrays/objects -> stringify for table friendliness
            infographics:
                detail.infographics !== undefined ? JSON.stringify(detail.infographics) : null,
        };

        // Include any other detail fields (except related already removed upstream)
        for (const k of Object.keys(detail)) {
            if (k in row) continue;
            const v = detail[k];
            row[k] = typeof v === "object" && v !== null ? JSON.stringify(v) : v;
        }

        // Include any list-only fields too (merge both sources by brs_id)
        if (list && typeof list === "object") {
            for (const k of Object.keys(list)) {
                if (k in row) continue;
                const v = list[k];
                row[k] = typeof v === "object" && v !== null ? JSON.stringify(v) : v;
            }
        }

        rows.push(row);
    }

    rows.sort((a, b) => new Date(b.rl_date) - new Date(a.rl_date));

    const columns = [
        { key: "brs_id", label: "ID" },
        { key: "title", label: "Judul" },
        { key: "rl_date", label: "Tanggal Rilis" },
        { key: "abstract", label: "Abstrak" },
        { key: "subcsa", label: "Kategori" },
        { key: "pdf_url", label: "PDF" },
        { key: "slide_url", label: "Slide" },
        { key: "thumbnail_url", label: "Thumbnail" },
        { key: "size", label: "Size" },
        { key: "hit", label: "Hit" },
        { key: "infographics", label: "Infographics" },
    ];

    return {
        source: `Press Release - ${keyword}`,
        period:
            rows.length > 0
                ? `${rows[rows.length - 1].rl_date} to ${rows[0].rl_date}`
                : new Date().toISOString(),
        columns,
        data: rows,
        last_update: last_update || new Date().toISOString(),
    };
};
