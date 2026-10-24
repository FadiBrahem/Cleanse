const decorateBuf = new Set();
let decorateTimer = null;

function scheduleDecorate(node) {
    decorateBuf.add(node);
    if (decorateTimer) return;
    decorateTimer = setTimeout(() => {
        decorateTimer = null;
        const nodes = [...decorateBuf];
        decorateBuf.clear();
        nodes.forEach(n => { if (n.isConnected) decorateWithin(n); });
    }, 150);
}

function isOwnNode(node) {
    const c = node.classList;
    return !!c && (c.contains('xrb-region-label') || c.contains('xrb-overlay') || c.contains('xrb-red-circle') ||
        c.contains('xrb-banner') || c.contains('xrb-profile-no-symbol'));
}

function startObserver() {
    new MutationObserver(mutations => {
        const newArticles = [];

        mutations.forEach(m => {
            m.addedNodes.forEach(node => {
                if (node.nodeType !== 1 || isOwnNode(node)) return;
                if (node.matches?.(ARTICLE_SEL)) newArticles.push(node);
                node.querySelectorAll?.(ARTICLE_SEL).forEach(a => newArticles.push(a));
                if (node.matches?.('[role="dialog"]')) setTimeout(() => checkAboutPopup(node), 400);
                scheduleDecorate(node);
            });
        });

        if (lastPath !== window.location.pathname) {
            lastPath = window.location.pathname;
            console.log('[XRB] Navigation to:', lastPath);
            document.querySelectorAll('.xrb-profile-banner, .xrb-profile-no-symbol').forEach(el => el.remove());
            document.querySelectorAll('[data-xrb-profile-circle]').forEach(el => delete el.dataset.xrbProfileCircle);
            setTimeout(checkProfilePage, 800);
            setTimeout(scanAll, 300);
            setTimeout(scanAll, 1200);
        }

        if (newArticles.length) {
            clearTimeout(window._xrbObsTimer);
            window._xrbObsTimer = setTimeout(() => newArticles.forEach(a => a.isConnected && processArticle(a)), 150);
        }
    }).observe(document.body, { childList: true, subtree: true });

    lastPath = window.location.pathname;
}

function startIntersectionObserver() {
    const io = new IntersectionObserver(entries => {
        entries.forEach(entry => {
            if (!entry.isIntersecting) return;
            const art = entry.target;
            if (!art.dataset.xrbProcessed && !art.dataset.xrbTreated) processArticle(art);
        });
    }, { rootMargin: '500px 0px', threshold: 0 });

    function observe() {
        document.querySelectorAll(ARTICLE_SEL).forEach(art => {
            if (!art.dataset.xrbObserved) { art.dataset.xrbObserved = 'true'; io.observe(art); }
        });
    }
    observe();
    new MutationObserver(observe).observe(document.body, { childList: true, subtree: true });
}

// Articles that are on screen but still unresolved (lookup dropped / paused) get re-queued
function retryVisibleArticles() {
    const h = window.innerHeight + 300;
    document.querySelectorAll(ARTICLE_SEL).forEach(art => {
        if (art.dataset.xrbTreated || art.dataset.xrbProcessed) return;
        const r = art.getBoundingClientRect();
        if (r.bottom > -300 && r.top < h) processArticle(art);
    });
}

function startIntervalScan() {
    let tick = 0;
    setInterval(() => {
        tick++;
        detectOwnUsername();
        if (blockedRegions.length || blockAffiliate || blockAffiliated) rescanDOM();
        checkProfilePage();
        checkAboutPage();

        if (tick % 2 === 0) retryVisibleArticles();
        if (tick % 2 === 1) decorateWithin(document.body);

        if (lookupQueue.length > 0 && !queueRunning && !lookupsPaused()) drainQueue();
    }, 1500);
}

// Learn passively from X's own About UI — no request of ours needed
function checkAboutPopup(root) {
    const text = root?.innerText || root?.textContent || '';
    const match = text.match(/[Aa]ccount\s+based\s+in\s+([^\n\r,<]{2,50})/);
    if (!match) return;
    nativeAboutAt = Date.now();
    const pageM = window.location.pathname.match(/^\/([A-Za-z0-9_]+)/);
    if (pageM && !SKIP.has(pageM[1].toLowerCase())) cacheResult(pageM[1].toLowerCase(), match[1].trim(), 'about');
}

function checkAboutPage() {
    const m = window.location.pathname.match(/^\/([A-Za-z0-9_]+)\/about\/?$/);
    if (!m) return;
    nativeAboutAt = Date.now();
    const col = document.querySelector('[data-testid="primaryColumn"]');
    const t = col && (col.innerText || '').match(/[Aa]ccount\s+based\s+in\s*\n?\s*([^\n\r<]{2,50})/);
    if (t && !memCache.has(m[1].toLowerCase())) cacheResult(m[1].toLowerCase(), t[1].trim(), 'about');
}
