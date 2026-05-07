const cheerio = require("cheerio");

function decodeHtmlEntities(input) {
    // BPS static table payload.table is HTML-escaped (e.g. &lt;table&gt;...)
    // Minimal decoder for common entities used in the payload.
    return String(input || "")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&");
}

module.exports = function processStatic(api) {
    try {
        const payload = api.data;
        const html = decodeHtmlEntities(payload.table);

        if (!html) {
            return {
                source: payload.title,
                columns: [],
                data: [],
                last_update: payload.updt_date
            };
        }

        const $ = cheerio.load(html);

        const columns = [];
        const data = [];

        // Ambil header tabel (<th>)
        $("table thead tr th").each((i, el) => {
            columns.push($(el).text().trim());
        });

        // Ambil baris data (<td>)
        $("table tbody tr").each((i, row) => {
            const cells = $(row).find("td");
            let obj = {};

            cells.each((j, cell) => {
                const colName = columns[j] || `col${j}`;
                obj[colName] = $(cell).text().trim();
            });

            data.push(obj);
        });

        return {
            source: payload.title,
            columns,
            data,
            last_update: payload.updt_date
        };

    } catch (err) {
        return { error: "Static parse failed", details: err.message };
    }
};
