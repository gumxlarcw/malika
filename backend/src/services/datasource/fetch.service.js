const axios = require("axios");
const FetchLog = require("../../models/FetchLog.model");
const logger = require("../../utils/logger");

async function fetchAPI(url, source_id = null, retries = 3) {
    try {
        const response = await axios.get(url, {
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/117.0",
                "Accept": "application/json,text/html,*/*",
                "Accept-Language": "en-US,en;q=0.9,id;q=0.8",
                "Accept-Encoding": "gzip, deflate, br",
                "Referer": "https://www.bps.go.id/",
                "Origin": "https://www.bps.go.id",
                "Cache-Control": "no-cache",
                "Pragma": "no-cache",
                "DNT": "1",
                "Connection": "keep-alive"
            },
            timeout: 20000
        });

        // Deteksi jika API mengembalikan HTML (Cloudflare / WAF)
        if (typeof response.data === "string" && response.data.startsWith("<")) {
            throw new Error("Invalid response: HTML received instead of JSON");
        }

        await FetchLog.create({
            source_id,
            status_code: response.status,
            message: "OK"
        });

        return response.data;

    } catch (err) {

        // Auto retry
        if (retries > 0) {
            logger.warn({ url, attempt: 3 - retries + 1 }, "Retrying fetch");
            return fetchAPI(url, source_id, retries - 1);
        }

        await FetchLog.create({
            source_id,
            status_code: err.response?.status || 500,
            message: err.message
        });

        logger.error({ url, error: err.message }, "Fetch failed");

        throw err;
    }
}

module.exports = { fetchAPI };
