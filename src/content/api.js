let lastDiscoveryAt = 0;

// Fallback only: normally the hash/feature flags are copied from X's own AboutAccountQuery traffic
async function discoverQueryHash() {
    if (Date.now() - lastDiscoveryAt < 10 * 60 * 1000) return;
    lastDiscoveryAt = Date.now();
    try {
        const scripts = [...document.querySelectorAll('script[src]')]
            .filter(s => /\/(main|api)\.[^/]*\.js/.test(s.src)).slice(0, 4);
        for (const script of scripts) {
            const res = await fetch(script.src);
            if (!res.ok) continue;
            const text = await res.text();
            const m = text.match(/queryId:\s*["']([A-Za-z0-9_-]{16,})["']\s*,\s*operationName:\s*["']AboutAccountQuery["']/)
                || text.match(/operationName:\s*["']AboutAccountQuery["']\s*,[^}]{0,80}queryId:\s*["']([A-Za-z0-9_-]{16,})["']/);
            if (m && m[1]) {
                aboutTemplate.hash = m[1];
                saveTemplate();
                console.log('[XRB] Discovered AboutAccountQuery hash:', m[1]);
                return;
            }
        }
    } catch (e) { }
}

function getCsrfToken() {
    const match = document.cookie.match(/ct0=([^;]+)/);
    return match ? match[1] : '';
}

function isAboutOpen() {
    if (/^\/[^/]+\/about\/?$/.test(window.location.pathname)) return true;
    const dlg = document.querySelector('[role="dialog"]');
    return !!(dlg && /account\s+based\s+in|about\s+this\s+account/i.test(dlg.textContent || ''));
}

// Never compete with X's own About screen / background tabs / active rate limits
function lookupsPaused() {
    const now = Date.now();
    return now < rateLimitedUntil || now - nativeAboutAt < 20000 || document.hidden || isAboutOpen();
}

function findFollowersDeep(o) {
    const q = [[o, 0]];
    while (q.length) {
        const [x, d] = q.shift();
        for (const k of Object.keys(x)) {
            const v = x[k];
            if (typeof v === 'number' && /^(?:normal_)?followers(?:_count)?$/i.test(k)) return v;
            if (v && typeof v === 'object' && !Array.isArray(v) && d < 3) q.push([v, d + 1]);
        }
    }
    return undefined;
}

function xHeaders() {
    return {
        'authorization': `Bearer ${BEARER}`,
        'x-csrf-token': getCsrfToken(),
        'x-twitter-active-user': 'yes',
        'x-twitter-auth-type': 'OAuth2Session',
        'x-twitter-client-language': 'en'
    };
}

function ingestUserResult(username, result) {
    const fc = findFollowersDeep(result);
    if (typeof fc === 'number') { followersCache.set(username, fc); persistRel(username); }
    const rp = result?.relationship_perspectives || {};
    const following = rp.following ?? result?.legacy?.following;
    const followedBy = rp.followed_by ?? result?.legacy?.followed_by;
    if (typeof following === 'boolean' || typeof followedBy === 'boolean') {
        if (updateRel(username, following, followedBy)) scheduleFullRefresh();
    }
}

async function lookupViaGraphQL(lower) {
    if (lookupsPaused()) return null;

    const cached = memCache.get(lower);
    if (cached) {
        const ttl = cached.country ? CACHE_TTL : NEG_TTL;
        if (Date.now() - cached.ts < ttl) return cached.country || null;
    }
    if (pendingUsernames.has(lower) || activeRequests >= MAX_CONCURRENT) return null;

    pendingUsernames.add(lower);
    activeRequests++;
    try {
        const features = aboutTemplate.features || JSON.stringify({
            hidden_profile_subscriptions_enabled: true,
            responsive_web_graphql_exclude_directive_enabled: true,
            verified_phone_label_enabled: false
        });
        let url = `https://x.com/i/api/graphql/${aboutTemplate.hash}/AboutAccountQuery`
            + `?variables=${encodeURIComponent(JSON.stringify({ screenName: lower }))}`
            + `&features=${encodeURIComponent(features)}`;
        if (aboutTemplate.fieldToggles) url += `&fieldToggles=${encodeURIComponent(aboutTemplate.fieldToggles)}`;

        const res = await fetch(url, {
            headers: {
                'authorization': `Bearer ${BEARER}`,
                'x-csrf-token': getCsrfToken(),
                'x-twitter-active-user': 'yes',
                'x-twitter-auth-type': 'OAuth2Session',
                'x-twitter-client-language': 'en'
            },
            credentials: 'include'
        });

        if (res.status === 429) {
            backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF);
            rateLimitedUntil = Date.now() + 15 * 60 * 1000;
            console.log('[XRB] 429 — lookups paused until', new Date(rateLimitedUntil).toLocaleTimeString());
            return null;
        }
        if (res.status === 401 || res.status === 403) {
            rateLimitedUntil = Date.now() + 5 * 60 * 1000;      // transient: don't poison the cache
            return null;
        }
        if (res.status === 400 || res.status === 404) {
            discoverQueryHash();                                  // stale hash after an X deploy; ONE retry path, throttled
            return null;
        }
        if (!res.ok) return null;

        const data = await res.json();
        const result = data?.data?.user_result_by_screen_name?.result || data?.data?.user?.result;
        if (!result) { cacheResult(lower, ''); return null; }    // suspended / not found

        ingestUserResult(lower, result);
        const country = result?.about_profile?.account_based_in || '';
        console.log('[XRB] Lookup:', lower, '->', country || '(none)');
        backoffMs = Math.max(BASE_INTERVAL, backoffMs * 0.85);
        cacheResult(lower, country, 'about');
        return country || null;
    } catch (e) {
        return null;
    } finally {
        activeRequests--;
        pendingUsernames.delete(lower);
    }
}

function queueLookup(username) {
    const lower = (username || '').toLowerCase();
    if (!lower || SKIP.has(lower)) return;
    if (!blockedRegions.length && !showLabels) return;           // nothing needs the data
    if (memCache.has(lower) || pendingUsernames.has(lower) || lookupQueueSet.has(lower)) return;
    if (Date.now() < rateLimitedUntil) return;
    if (lookupQueue.length >= MAX_QUEUE_SIZE) {                  // drop the OLDEST (probably scrolled past)
        const old = lookupQueue.shift();
        lookupQueueSet.delete(old);
    }
    lookupQueue.push(lower);
    lookupQueueSet.add(lower);
    if (!queueRunning) drainQueue();
}

async function drainQueue() {
    if (queueRunning) return;
    queueRunning = true;
    try {
        while (lookupQueue.length > 0) {
            if (!alive()) break;
            if (lookupsPaused()) break;                          // interval scan resumes us
            if (activeRequests >= MAX_CONCURRENT) { await sleep(300); continue; }
            const username = lookupQueue.pop();                  // newest first = what's on screen now
            if (!username) continue;
            lookupQueueSet.delete(username);
            if (memCache.has(username)) continue;
            await lookupViaGraphQL(username);
            await sleep(backoffMs + Math.random() * 800);       // jitter
        }
    } finally {
        queueRunning = false;
    }
}

// ── Follower counts: X no longer ships them in timeline data, so fetch per account (only for accounts that need
//    a chip, only ones near the viewport, ≤60 per 15 min). Uses the UserByScreenName request shape X itself used. ──
function followersBudgetOk() {
    const now = Date.now();
    while (followerStamps.length && now - followerStamps[0] > FOLLOWERS_WINDOW) followerStamps.shift();
    return followerStamps.length < FOLLOWERS_BUDGET;
}

function queueFollowers(u) {
    if (!userTemplate.hash || !userTemplate.variables) return;       // learned after X loads any profile
    if (followersCache.has(u) || followersTried.has(u) || followersQueueSet.has(u)) return;
    if (Date.now() < userRateLimitedUntil) return;
    if (followersQueue.length >= 40) followersQueueSet.delete(followersQueue.shift());
    followersQueue.push(u);
    followersQueueSet.add(u);
    if (!followersRunning) drainFollowers();
}

async function drainFollowers() {
    if (followersRunning) return;
    followersRunning = true;
    try {
        while (followersQueue.length) {
            if (!alive() || document.hidden || Date.now() < userRateLimitedUntil || !followersBudgetOk()) break;
            const u = followersQueue.pop();                           // newest = what's on screen
            followersQueueSet.delete(u);
            if (followersCache.has(u)) continue;
            await lookupFollowers(u);
            await sleep(2500 + Math.random() * 1500);
        }
    } finally {
        followersRunning = false;
    }
}

async function lookupFollowers(u) {
    followersTried.add(u);
    followerStamps.push(Date.now());
    try {
        let vars;
        try { vars = JSON.parse(userTemplate.variables); } catch (e) { return; }
        let set = false;
        for (const k of Object.keys(vars)) if (/^screen_?name$/i.test(k)) { vars[k] = u; set = true; }
        if (!set) return;
        let url = `https://x.com/i/api/graphql/${userTemplate.hash}/UserByScreenName?variables=${encodeURIComponent(JSON.stringify(vars))}`;
        if (userTemplate.features) url += `&features=${encodeURIComponent(userTemplate.features)}`;
        if (userTemplate.fieldToggles) url += `&fieldToggles=${encodeURIComponent(userTemplate.fieldToggles)}`;
        const res = await fetch(url, { headers: xHeaders(), credentials: 'include' });
        if (res.status === 429) { userRateLimitedUntil = Date.now() + 15 * 60 * 1000; followersTried.delete(u); return; }
        if (!res.ok) return;
        const data = await res.json();
        const result = data?.data?.user?.result || data?.data?.user_result_by_screen_name?.result;
        if (!result) return;
        ingestUserResult(u, result);
        scheduleDecorate(document.body);
    } catch (e) { }
}
