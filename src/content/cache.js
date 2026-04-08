async function loadDiskCache() {
    try {
        const stored = await chrome.storage.local.get(CACHE_KEY);
        const raw = stored[CACHE_KEY] || {};
        const now = Date.now();
        let loaded = 0;
        for (const [username, entry] of Object.entries(raw)) {
            const ttl = entry.country ? CACHE_TTL : NEG_TTL;
            if (now - entry.ts < ttl) {
                memCache.set(username, entry);
                if (entry.country && isBlocked(entry.country)) {
                    blockedUsernames.add(username);
                }
                loaded++;
            }
        }
        console.log('[XRB] Cache loaded:', loaded, 'entries,', blockedUsernames.size, 'blocked');
    } catch (e) { }
}

async function saveToDiskCache(username, country) {
    try {
        const stored = await chrome.storage.local.get(CACHE_KEY);
        const raw = stored[CACHE_KEY] || {};
        raw[username] = { country: country || '', ts: Date.now() };
        if (Object.keys(raw).length > 8000) {
            const sorted = Object.entries(raw).sort((a, b) => b[1].ts - a[1].ts).slice(0, 6000);
            await chrome.storage.local.set({ [CACHE_KEY]: Object.fromEntries(sorted) });
        } else {
            await chrome.storage.local.set({ [CACHE_KEY]: raw });
        }
    } catch (e) { }
}

function cacheResult(username, country) {
    const lower = username.toLowerCase();
    memCache.set(lower, { country: country || '', ts: Date.now() });
    saveToDiskCache(lower, country);
    if (country && isBlocked(country)) {
        blockedUsernames.add(lower);
        rescanDOM();
        checkProfilePage();
    }
}
