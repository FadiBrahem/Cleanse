function loadSettings(cb) {
    chrome.storage.sync.get(['blockedRegions', 'blockMode', 'blockAffiliate', 'themeColor'], data => {
        blockedRegions = (data.blockedRegions || []).map(r => r.toLowerCase().trim());
        blockMode = data.blockMode || 'overlay';
        blockAffiliate = !!data.blockAffiliate;
        themeColor = data.themeColor || '#ff2222';
        console.log('[XRB] Settings:', blockedRegions, blockMode, blockAffiliate, themeColor);
        applyThemeStyle();
        if (cb) cb();
    });
}

chrome.storage.onChanged.addListener(changes => {
    if (changes.blockedRegions || changes.blockMode || changes.blockAffiliate || changes.themeColor) {
        loadSettings(() => {
            blockedUsernames.clear();
            pendingUsernames.clear();
            clearVisualTreatments();
            memCache.forEach((val, username) => {
                if (val.country && isBlocked(val.country)) blockedUsernames.add(username);
            });
            scanAll();
            checkProfilePage();
        });
    }
});

function listenToInjector() {
    window.addEventListener(CHANNEL, (e) => {
        const { type, payload } = e.detail || {};
        if (type === 'about_country') {
            console.log('[XRB] Free data from X:', payload.username, '->', payload.country);
            cacheResult(payload.username, payload.country);
        }
        if (type === 'legacy_location') {
            const { username, location } = payload;
            if (location && isBlocked(location)) {
                cacheResult(username, location);
            } else if (!memCache.has(username)) {
                queueLookup(username);
            }
        }
        if (type === 'affiliate_tweet') {
            const { tweetId } = payload;
            affiliateTweetIds.add(tweetId);
            rescanDOM();
        }
    });
}

async function init() {
    await loadDiskCache();
    loadSettings(async () => {
        listenToInjector();
        startObserver();
        startIntersectionObserver();
        startIntervalScan();
        discoverQueryHash();

        scanAll();
        setTimeout(scanAll, 500);
        setTimeout(scanAll, 1500);
        setTimeout(scanAll, 3000);
        setTimeout(checkProfilePage, 1000);
        setTimeout(checkProfilePage, 2500);
        setTimeout(checkProfilePage, 4000);
    });
    console.log('[XRB] v1.0 modular rebuilt ready');
}

init();
