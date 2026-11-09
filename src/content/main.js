const SETTING_KEYS = ['blockedRegions', 'blockMode', 'blockAffiliate', 'blockAffiliated', 'whitelistMode',
    'showLabels', 'themeColor', 'labelColor', 'showFollowers', 'followersMode', 'showRelation', 'relOnlyFollowing'];

function loadSettings(cb) {
    chrome.storage.sync.get(SETTING_KEYS, data => {
        blockedRegions = (data.blockedRegions || []).map(r => r.toLowerCase().trim()).filter(Boolean);
        compileRegions();
        blockMode = data.blockMode || 'overlay';
        blockAffiliate = !!data.blockAffiliate;
        blockAffiliated = !!data.blockAffiliated;
        whitelistMode = data.whitelistMode || 'mutuals';
        showLabels = data.showLabels !== false;
        followersMode = data.followersMode || (data.showFollowers === false ? 'off' : 'nofollowback');
        showRelation = data.showRelation !== false;
        relOnlyFollowing = data.relOnlyFollowing !== false;
        themeColor = data.themeColor || '#ff2222';
        labelColor = data.labelColor || '#22c55e';
        applyThemeStyle();
        if (cb) cb();
    });
}

chrome.storage.onChanged.addListener((changes, area) => {
    if (!alive()) return;
    if (area !== 'sync') return;
    const keys = ['blockedRegions', 'blockMode', 'blockAffiliate', 'blockAffiliated', 'whitelistMode',
        'showLabels', 'themeColor', 'labelColor', 'followersMode', 'showRelation', 'relOnlyFollowing'];
    if (!keys.some(k => changes[k])) return;
    loadSettings(() => {
        pendingUsernames.clear();
        clearVisualTreatments();
        scanAll();
        decorateWithin(document.body);
        checkProfilePage();
    });
});

function listenToInjector() {
    window.addEventListener(CHANNEL, e => {
        if (!alive()) { shutdown(); return; }
        let msg = e.detail;
        try { if (typeof msg === 'string') msg = JSON.parse(msg); } catch (_) { return; }
        const { type, payload } = msg || {};
        if (!type || !payload) return;

        switch (type) {
            case 'user_info': {
                const { username, location, following, followedBy, affiliated, followers } = payload;
                if (typeof followers === 'number') { followersCache.set(username, followers); persistRel(username); }
                if (typeof following === 'boolean' || typeof followedBy === 'boolean') {
                    if (updateRel(username, following, followedBy)) scheduleFullRefresh();
                }
                if (affiliated) affiliatedUsers.add(username);
                if (location) {
                    // Free-text profile location: used ONLY as a blocking fallback, never displayed
                    profileLoc.set(username, location);
                    if (isBlocked(location) && !memCache.has(username)) scheduleRefresh();
                }
                scheduleDecorate(document.body);
                break;
            }
            case 'about_country':
                nativeAboutAt = Date.now();
                cacheResult(payload.username, payload.country, 'about');
                break;
            case 'about_native':
                nativeAboutAt = Date.now();
                if (payload.status === 429) {
                    rateLimitedUntil = Math.max(rateLimitedUntil, Date.now() + 10 * 60 * 1000);
                    console.log('[XRB] X itself got 429 on About — pausing our lookups');
                }
                break;
            case 'query_template':
                if (payload.op === 'UserByScreenName' && payload.hash) {
                    userTemplate.hash = payload.hash;
                    userTemplate.features = payload.features || null;
                    userTemplate.fieldToggles = payload.fieldToggles || null;
                    userTemplate.variables = payload.variables || null;
                    saveTemplate();
                } else if (payload.hash) {
                    aboutTemplate.hash = payload.hash;
                    if (payload.features) aboutTemplate.features = payload.features;
                    if (payload.fieldToggles) aboutTemplate.fieldToggles = payload.fieldToggles;
                    saveTemplate();
                }
                break;
            case 'affiliate_tweet': {
                const { tweetId, username } = payload;
                if (!affiliateTweetIds.has(tweetId)) {
                    affiliateTweetIds.add(tweetId);
                    if (username) affiliateUserCounts.set(username, (affiliateUserCounts.get(username) || 0) + 1);
                    if (blockAffiliate) scheduleRefresh();
                }
                break;
            }
        }
    });
    // Tell the injector we're listening so it can replay what it buffered before we loaded
    window.dispatchEvent(new CustomEvent(READY_EVENT));
}

async function init() {
    document.documentElement.dataset.xrbInstance = INSTANCE_ID;   // claim the page: older instances will see this and stop
    await loadDiskCache();
    loadSettings(() => {
        clearVisualTreatments();                                    // remove anything left behind by an older instance
        detectOwnUsername();
        listenToInjector();
        initUnfollowListener();
        startObserver();
        startIntersectionObserver();
        startIntervalScan();
        if (!aboutTemplate.features) setTimeout(discoverQueryHash, 4000);

        scanAll();
        decorateWithin(document.body);
        setTimeout(scanAll, 500);
        setTimeout(scanAll, 1500);
        setTimeout(scanAll, 3000);
        setTimeout(checkProfilePage, 1000);
        setTimeout(checkProfilePage, 2500);
        resumePendingUnfollow();
    });
    console.log('[XRB] v1.7 ready');
}

init();
