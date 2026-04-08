async function discoverQueryHash() {
    try {
        const scripts = [...document.querySelectorAll('script[src*="main."]')];
        for (const script of scripts.slice(0, 3)) {
            const res = await fetch(script.src);
            if (!res.ok) continue;
            const text = await res.text();
            const m1 = text.match(/["']([A-Za-z0-9_-]{20,})["'][^"']{0,80}AboutAccountQuery/);
            const m2 = text.match(/AboutAccountQuery[^"']{0,80}["']([A-Za-z0-9_-]{20,})["']/);
            const hash = (m1 || m2)?.[1];
            if (hash) {
                aboutQueryHash = hash;
                console.log('[XRB] Discovered hash:', hash);
                return;
            }
        }
    } catch (e) { }
}

async function lookupViaGraphQL(username) {
    const lower = username.toLowerCase();

    if (Date.now() < rateLimitedUntil) return null;

    const cached = memCache.get(lower);
    if (cached) {
        const ttl = cached.country ? CACHE_TTL : NEG_TTL;
        if (Date.now() - cached.ts < ttl) return cached.country || null;
    }

    if (pendingUsernames.has(lower)) return null;
    if (activeRequests >= MAX_CONCURRENT) return null;

    const elapsed = Date.now() - lastRequestTime;
    if (elapsed < backoffMs) await sleep(backoffMs - elapsed);

    pendingUsernames.add(lower);
    activeRequests++;
    lastRequestTime = Date.now();

    const hashes = [aboutQueryHash, ...HASH_FALLBACKS.filter(h => h !== aboutQueryHash)];

    for (const hash of hashes) {
        try {
            const variables = encodeURIComponent(JSON.stringify({ screenName: lower }));
            const features = encodeURIComponent(JSON.stringify({
                hidden_profile_subscriptions_enabled: true,
                responsive_web_graphql_exclude_directive_enabled: true,
                verified_phone_label_enabled: false
            }));
            const url = `https://x.com/i/api/graphql/${hash}/AboutAccountQuery?variables=${variables}&features=${features}`;

            const res = await fetch(url, {
                headers: {
                    'authorization': `Bearer ${BEARER}`,
                    'x-csrf-token': getCsrfToken(),
                    'x-twitter-active-user': 'yes',
                    'x-twitter-auth-type': 'OAuth2Session',
                },
                credentials: 'include'
            });

            if (res.status === 429) {
                backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF);
                rateLimitedUntil = Date.now() + (15 * 60 * 1000);
                console.log('[XRB] 429 — backing off until', new Date(rateLimitedUntil).toLocaleTimeString(), '| next interval:', backoffMs, 'ms');
                activeRequests--;
                pendingUsernames.delete(lower);
                return null;
            }

            if (res.status === 403 || res.status === 401) {
                activeRequests--;
                pendingUsernames.delete(lower);
                cacheResult(lower, '');
                return null;
            }

            if (!res.ok) continue;

            const data = await res.json();
            if (data.errors) continue;

            const result = data?.data?.user_result_by_screen_name?.result
                || data?.data?.user?.result;
            let country = result?.about_profile?.account_based_in || '';

            if (!country) {
                country = result?.legacy?.location || '';
            }

            if (!country) {
                try {
                    const ubsnVars = encodeURIComponent(JSON.stringify({ screen_name: lower, withSafetyModeUserFields: true }));
                    const ubsnFeatures = encodeURIComponent(JSON.stringify({ hidden_profile_subscriptions_enabled: true, responsive_web_graphql_exclude_directive_enabled: true, verified_phone_label_enabled: false }));
                    const ubsnHashes = ['G3KGOASz96M-Qu0nwmGXNg', 'qW5u-DAuXpMEG0zA1F7UGQ', 'SAMkL5y_N9pmahSw8yy6gA'];
                    for (const ubsnHash of ubsnHashes) {
                        const ubsnUrl = `https://x.com/i/api/graphql/${ubsnHash}/UserByScreenName?variables=${ubsnVars}&features=${ubsnFeatures}`;
                        const ubsnRes = await fetch(ubsnUrl, {
                            headers: {
                                'authorization': `Bearer ${BEARER}`,
                                'x-csrf-token': getCsrfToken(),
                                'x-twitter-active-user': 'yes',
                                'x-twitter-auth-type': 'OAuth2Session',
                            },
                            credentials: 'include'
                        });
                        if (!ubsnRes.ok) continue;
                        const ubsnData = await ubsnRes.json();
                        const ubsnLoc = ubsnData?.data?.user?.result?.legacy?.location || '';
                        if (ubsnLoc) { country = ubsnLoc; break; }
                    }
                } catch (e) { }
            }

            console.log('[XRB] Lookup:', lower, '->', country || '(none)');
            if (hash !== aboutQueryHash) {
                aboutQueryHash = hash;
                console.log('[XRB] Updated working hash to:', hash);
            }
            backoffMs = Math.max(800, backoffMs * 0.8);

            cacheResult(lower, country);
            activeRequests--;
            pendingUsernames.delete(lower);
            return country || null;

        } catch (e) { continue; }
    }

    cacheResult(lower, '');
    activeRequests--;
    pendingUsernames.delete(lower);
    return null;
}

function getCsrfToken() {
    const match = document.cookie.match(/ct0=([^;]+)/);
    return match ? match[1] : '';
}

function queueLookup(username) {
    const lower = username.toLowerCase();
    if (memCache.has(lower) || pendingUsernames.has(lower) || blockedUsernames.has(lower)) return;
    if (lookupQueueSet.has(lower)) return;
    if (Date.now() < rateLimitedUntil) return;
    if (lookupQueue.length >= MAX_QUEUE_SIZE) return;
    lookupQueue.push(lower);
    lookupQueueSet.add(lower);
    if (!queueRunning) drainQueue();
}

async function drainQueue() {
    if (queueRunning) return;
    queueRunning = true;
    while (lookupQueue.length > 0) {
        if (Date.now() < rateLimitedUntil) {
            console.log('[XRB] Queue paused — rate limited');
            break;
        }
        if (activeRequests >= MAX_CONCURRENT) {
            await sleep(200);
            continue;
        }
        const username = lookupQueue.shift();
        if (!username) continue;
        lookupQueueSet.delete(username);
        if (memCache.has(username) || blockedUsernames.has(username)) continue;
        lookupViaGraphQL(username);
        await sleep(backoffMs);
    }
    queueRunning = false;
}
