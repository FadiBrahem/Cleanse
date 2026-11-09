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

function ingestUserResult(username, result) {
    const fc = result?.legacy?.followers_count;
    if (typeof fc === 'number') followersCache.set(username, fc);
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
