function startObserver() {
    new MutationObserver(mutations => {
        const newArticles = [];
        let urlChanged = false;

        mutations.forEach(m => {
            m.addedNodes.forEach(node => {
                if (node.nodeType !== 1) return;
                if (node.matches?.('article[data-testid="tweet"], article[role="article"]')) newArticles.push(node);
                node.querySelectorAll?.('article[data-testid="tweet"], article[role="article"]').forEach(a => newArticles.push(a));
                if (node.matches?.('[role="dialog"]')) setTimeout(() => checkAboutPopup(node), 400);
            });
        });

        if (lastPath !== window.location.pathname) {
            lastPath = window.location.pathname;
            urlChanged = true;
            console.log('[XRB] Navigation to:', lastPath);
            document.querySelectorAll('.xrb-profile-banner, .xrb-profile-no-symbol').forEach(el => el.remove());
            document.querySelectorAll('[data-xrb-profile-circle]').forEach(el => delete el.dataset.xrbProfileCircle);
            setTimeout(checkProfilePage, 800);
            setTimeout(scanAll, 300);
            setTimeout(scanAll, 1200);
        }

        if (newArticles.length) {
            clearTimeout(window._xrbObsTimer);
            window._xrbObsTimer = setTimeout(() => newArticles.forEach(processArticle), 150);
        }
    }).observe(document.body, { childList: true, subtree: true });

    lastPath = window.location.pathname;
}

function startIntersectionObserver() {
    const io = new IntersectionObserver(entries => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const art = entry.target;
                if (!art.dataset.xrbDone) processArticle(art);
            }
        });
    }, { rootMargin: '500px 0px', threshold: 0 });

    function observe() {
        document.querySelectorAll('article[data-testid="tweet"], article[role="article"]').forEach(art => {
            if (!art.dataset.xrbObserved) { art.dataset.xrbObserved = 'true'; io.observe(art); }
        });
    }
    observe();
    new MutationObserver(observe).observe(document.body, { childList: true, subtree: true });
}

function startIntervalScan() {
    setInterval(() => {
        if (blockedUsernames.size > 0) rescanDOM();
        checkProfilePage();

        document.querySelectorAll('article[data-testid="tweet"][data-xrb-queued]:not([data-xrb-done])').forEach(art => {
            const username = getUsernameFromArticle(art);
            if (!username) return;
            if (!memCache.has(username) && !pendingUsernames.has(username)) {
                delete art.dataset.xrbQueued;
                queueLookup(username);
            }
        });

        if (Date.now() >= rateLimitedUntil && lookupQueue.length > 0 && !queueRunning) {
            console.log('[XRB] Rate limit lifted, resuming queue of', lookupQueue.length);
            drainQueue();
        }
    }, 2000);
}

function checkAboutPopup(root) {
    const text = root?.innerText || root?.textContent || '';
    const match = text.match(/[Aa]ccount\s+based\s+in\s+([^\n\r,<]{2,50})/);
    if (!match) return;
    const country = match[1].trim();
    if (!isBlocked(country)) return;
    console.log('[XRB] About popup detected:', country);
    const pageM = window.location.pathname.match(/^\/([A-Za-z0-9_]+)/);
    if (pageM && !SKIP.has(pageM[1].toLowerCase())) cacheResult(pageM[1].toLowerCase(), country);
}
