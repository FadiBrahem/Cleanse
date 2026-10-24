const pendingDisk = new Map();
let diskTimer = null;
let refreshTimer = null;
let fullRefreshTimer = null;

async function loadDiskCache() {
    try {
        const stored = await chrome.storage.local.get([CACHE_KEY, TEMPLATE_KEY]);
        const raw = stored[CACHE_KEY] || {};
        const now = Date.now();
        let loaded = 0;
        for (const [username, entry] of Object.entries(raw)) {
            const ttl = entry.country ? CACHE_TTL : NEG_TTL;
            if (now - entry.ts < ttl) { memCache.set(username, entry); loaded++; }
        }
        const t = stored[TEMPLATE_KEY];
        if (t && t.hash) {
            aboutTemplate.hash = t.hash;
            aboutTemplate.features = t.features || null;
            aboutTemplate.fieldToggles = t.fieldToggles || null;
        }
        console.log('[XRB] Cache loaded:', loaded, 'entries');
    } catch (e) { }
}

function saveTemplate() {
    try { chrome.storage.local.set({ [TEMPLATE_KEY]: { ...aboutTemplate } }); } catch (e) { }
}

// Writes are batched: one read-modify-write per 3s instead of one per lookup
function saveToDiskCache(username, country, src) {
    pendingDisk.set(username, { country: country || '', ts: Date.now(), src: src || 'about' });
    if (!diskTimer) diskTimer = setTimeout(flushDiskCache, 3000);
}

async function flushDiskCache() {
    diskTimer = null;
    if (!pendingDisk.size) return;
    const batch = [...pendingDisk];
    pendingDisk.clear();
    try {
        const stored = await chrome.storage.local.get(CACHE_KEY);
        let raw = stored[CACHE_KEY] || {};
        for (const [u, e] of batch) raw[u] = e;
        if (Object.keys(raw).length > 8000) {
            raw = Object.fromEntries(Object.entries(raw).sort((a, b) => b[1].ts - a[1].ts).slice(0, 6000));
        }
        await chrome.storage.local.set({ [CACHE_KEY]: raw });
    } catch (e) { }
}

function cacheResult(username, country, src) {
    const lower = username.toLowerCase();
    memCache.set(lower, { country: country || '', ts: Date.now(), src: src || 'about' });
    saveToDiskCache(lower, country, src);
    scheduleRefresh();
}

// Cheap, debounced: apply treatments to new matches + refresh region labels
function scheduleRefresh() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
        if (blockedRegions.length) rescanDOM();
        decorateWithin(document.body);
        checkProfilePage();
    }, 120);
}

// Heavier: used when an account's exemption status flips (e.g. we learn you follow each other)
function scheduleFullRefresh() {
    clearTimeout(fullRefreshTimer);
    fullRefreshTimer = setTimeout(() => {
        clearVisualTreatments();
        scanAll();
        decorateWithin(document.body);
        checkProfilePage();
    }, 300);
}
