const pendingDisk = new Map();
const pendingRel = new Map();
let relTimer = null;
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
        try {
            const rs = (await chrome.storage.local.get(REL_KEY))[REL_KEY] || {};
            for (const [u, e] of Object.entries(rs)) {
                if (now - e.ts < 7 * 24 * 60 * 60 * 1000) relCache.set(u, { following: e.f, followedBy: e.fb });
            }
        } catch (e) { }
        const t = stored[TEMPLATE_KEY];
        if (t && t.hash) {
            aboutTemplate.hash = t.hash;
            aboutTemplate.features = t.features || null;
            aboutTemplate.fieldToggles = t.fieldToggles || null;
        }
        console.log('[XRB] Cache loaded:', loaded, 'entries');
    } catch (e) { }
}

// Follow relationships learned from X's data or from your Following/Followers pages (kept 7 days)
function persistRel(u) {
    const r = relCache.get(u);
    if (!r || typeof r.followedBy !== 'boolean') return;
    pendingRel.set(u, { f: r.following, fb: r.followedBy, ts: Date.now() });
    if (!relTimer) relTimer = setTimeout(flushRel, 4000);
}

async function flushRel() {
    relTimer = null;
    if (!pendingRel.size) return;
    const batch = [...pendingRel];
    pendingRel.clear();
    try {
        let raw = (await chrome.storage.local.get(REL_KEY))[REL_KEY] || {};
        for (const [u, e] of batch) raw[u] = e;
        if (Object.keys(raw).length > 6000) {
            raw = Object.fromEntries(Object.entries(raw).sort((a, b) => b[1].ts - a[1].ts).slice(0, 4500));
        }
        await chrome.storage.local.set({ [REL_KEY]: raw });
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
