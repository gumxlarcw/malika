/**
 * Fetch detail untuk setiap brs_id dari API detail pressrelease
 * 
 * Input: { source_id, brs_ids, source, domain_id, api_key }
 * Output: { brs_id: {...detail...}, ... }
 */

const { fetchAPI } = require("../datasource/fetch.service");

async function fetchPressReleaseDetail({ source_id, brs_ids, source, domain_id = 8200, api_key }) {
    const detailMap = {};
    
    if (!api_key || !String(api_key).trim()) {
        throw new Error('BPS API key not set or invalid');
    }
    
    try {
        console.log(`[PressRelease] Fetching detail for ${brs_ids.length} items...`);
        
        // Parallel fetch with rate limiting (Promise.allSettled untuk handle errors gracefully)
        const CONCURRENT_LIMIT = 5;
        const detailPromises = brs_ids.map((brs_id, index) => {
            const detailUrl = `https://webapi.bps.go.id/v1/api/view/domain/${domain_id}/model/pressrelease/lang/ind/id/${brs_id}/key/${api_key}/`;
            
            return (async () => {
                try {
                    const data = await fetchAPI(detailUrl, source_id);
                    
                    // Validate response
                    if (data.data && typeof data.data === 'object') {
                        // Requirement: take all fields except `related`
                        const { related, ...rest } = data.data;
                        return { brs_id, data: rest, status: 'success' };
                    } else {
                        console.warn(`[PressRelease] Invalid detail response for brs_id ${brs_id}`);
                        return { brs_id, data: null, status: 'invalid' };
                    }
                } catch (err) {
                    console.warn(`[PressRelease] Failed to fetch detail ${brs_id}:`, err.message);
                    return { brs_id, data: null, status: 'error' };
                }
            })();
        });
        
        // Execute with controlled concurrency
        const results = [];
        for (let i = 0; i < detailPromises.length; i += CONCURRENT_LIMIT) {
            const batch = detailPromises.slice(i, i + CONCURRENT_LIMIT);
            const batchResults = await Promise.all(batch);
            results.push(...batchResults);
        }
        
        // Map hasil
        let successCount = 0;
        results.forEach(result => {
            if (result.status === 'success' && result.data) {
                detailMap[result.brs_id] = result.data;
                successCount++;
            }
        });
        
        console.log(`[PressRelease] Successfully fetched ${successCount}/${brs_ids.length} details`);
        
        if (successCount === 0) {
            throw new Error(`Failed to fetch any detail data (0/${brs_ids.length})`);
        }
        
        return detailMap;
        
    } catch (err) {
        console.error('[PressRelease] Detail fetch error:', err.message);
        throw err;
    }
}

module.exports = { fetchPressReleaseDetail };
