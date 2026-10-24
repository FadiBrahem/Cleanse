function applyThemeStyle() {
    let styleEl = document.getElementById('xrb-theme-style');
    if (!styleEl) {
        styleEl = document.createElement('style');
        styleEl.id = 'xrb-theme-style';
        document.head.appendChild(styleEl);
    }
    const hex = themeColor.replace('#', '');
    let r = parseInt(hex.substring(0, 2), 16);
    let g = parseInt(hex.substring(2, 4), 16);
    let b = parseInt(hex.substring(4, 6), 16);
    if (isNaN(r)) r = 255;
    if (isNaN(g)) g = 34;
    if (isNaN(b)) b = 34;
    const rgb = `${r},${g},${b}`;

    styleEl.textContent = `
    .xrb-red-circle {
      border-color: ${themeColor} !important;
      box-shadow: 0 0 0 2px rgba(${rgb}, 0.35) !important;
    }
    .xrb-red-circle::after { background: ${themeColor} !important; }
    .xrb-banner {
      background: linear-gradient(90deg, rgba(${rgb}, 0.12), rgba(${rgb}, 0.05)) !important;
      border-left-color: ${themeColor} !important;
      border-bottom-color: rgba(${rgb}, 0.2) !important;
      color: ${themeColor} !important;
    }
    .xrb-region-label { color: ${labelColor} !important; border-color: ${labelColor} !important; }
    .xrb-region-label--blocked { color: ${themeColor} !important; border-color: ${themeColor} !important; }
    @keyframes xrb-pulse {
      0%,100% { box-shadow: 0 0 0 2px rgba(${rgb}, 0.35); }
      50%      { box-shadow: 0 0 0 4px rgba(${rgb}, 0.55); }
    }
  `;
}

function detectOwnUsername() {
    const a = document.querySelector('a[data-testid="AppTabBar_Profile_Link"]');
    const m = a && (a.getAttribute('href') || '').match(/^\/([A-Za-z0-9_]+)/);
    if (m) ownUsername = m[1].toLowerCase();
}

// ───────────────────────── Treatments ─────────────────────────

function applyTreatment(article, locationText) {
    if (article.dataset.xrbTreated) return;
    article.dataset.xrbTreated = 'true';

    if (blockMode === 'hide') {
        article.style.display = 'none';
        return;
    }
    if (blockMode === 'blur') {
        article.style.filter = 'blur(7px)';
        article.style.opacity = '0.3';
        article.style.pointerEvents = 'none';
        return;
    }

    const tweetCell = article.querySelector('[data-testid="tweet"]') || article;
    tweetCell.style.position = 'relative';

    const avatar = article.querySelector('img[src*="profile_images"]');
    if (avatar) {
        const wrap = avatar.closest('a') || avatar.parentElement;
        if (wrap && !wrap.dataset.xrbCircle) {
            wrap.style.cssText += 'position:relative!important;display:inline-block!important;z-index:9998!important;';
            const circle = document.createElement('div');
            circle.className = 'xrb-red-circle';
            circle.title = `Blocked: ${locationText}`;
            wrap.appendChild(circle);
            wrap.dataset.xrbCircle = 'true';
        }
    }

    if (!tweetCell.querySelector('.xrb-overlay')) {
        const overlay = document.createElement('div');
        overlay.className = 'xrb-overlay';
        overlay.style.cssText = [
            'position:absolute!important', 'top:0!important', 'left:0!important',
            'width:100%!important', 'height:100%!important',
            'background:rgba(0,0,0,0.90)!important', 'z-index:9990!important',
            'pointer-events:none!important', 'display:flex!important',
            'flex-direction:column!important', 'align-items:center!important',
            'justify-content:center!important', 'gap:6px!important',
            'border-radius:inherit!important',
        ].join(';');
        overlay.innerHTML = `
      <div style="width:30px;height:30px;border-radius:50%;border:3px solid ${themeColor};position:relative;flex-shrink:0;">
        <div style="position:absolute;top:50%;left:50%;width:130%;height:3px;background:${themeColor};transform:translate(-50%,-50%) rotate(-45deg);border-radius:2px;"></div>
      </div>
      <span style="font-size:11px;font-weight:600;color:rgba(255,255,255,0.7);letter-spacing:0.08em;text-transform:uppercase;font-family:-apple-system,sans-serif;">Blocked</span>
      <span style="font-size:12px;color:${themeColor};font-weight:500;font-family:-apple-system,sans-serif;">${escapeHtml(locationText)}</span>
    `;
        tweetCell.appendChild(overlay);
    }
}

function checkProfilePage() {
    const pageMatch = window.location.pathname.match(/^\/([A-Za-z0-9_]+)(?:\/|$)/);
    if (!pageMatch) return;
    const username = pageMatch[1].toLowerCase();
    if (SKIP.has(username)) return;

    if (isUserBlocked(username)) {
        applyProfileBlock(username);
    } else if (!memCache.has(username) && !pendingUsernames.has(username)) {
        queueLookup(username);
    }
}

function applyProfileBlock(username) {
    const country = blockReason(username) || 'blocked region';

    const avatarSelectors = [
        '[data-testid="UserProfileHeader_Items"] ~ * a[href$="/photo"] img[src*="profile_images"]',
        'a[href$="/photo"] img[src*="profile_images"]',
        'a[href*="/photo"] img[src*="profile_images"]',
        '[data-testid="UserAvatar"] img[src*="profile_images"]',
        'img[src*="profile_images"][alt]:not([src*="_normal"])',
    ];
    let profileAvatar = null;
    for (const sel of avatarSelectors) {
        profileAvatar = document.querySelector(sel);
        if (profileAvatar) break;
    }

    if (profileAvatar) {
        const wrap = profileAvatar.closest('a, [data-testid="UserAvatar"]') || profileAvatar.parentElement;
        if (wrap && !wrap.dataset.xrbProfileCircle) {
            wrap.style.cssText += 'position:relative!important;display:inline-block!important;';
            wrap.dataset.xrbProfileCircle = 'true';

            const noSymbol = document.createElement('div');
            noSymbol.className = 'xrb-profile-no-symbol';
            noSymbol.title = `Blocked: ${country}`;
            noSymbol.style.cssText = [
                'position:absolute!important', 'inset:0!important', 'border-radius:50%!important',
                'border:4px solid ' + themeColor + '!important', 'z-index:9999!important',
                'pointer-events:none!important', 'box-sizing:border-box!important',
                'animation:xrb-pulse 2s ease-in-out infinite!important',
            ].join(';');

            const slash = document.createElement('div');
            slash.style.cssText = [
                'position:absolute!important', 'top:50%!important', 'left:50%!important',
                'width:135%!important', 'height:4px!important', 'background:' + themeColor + '!important',
                'transform:translate(-50%,-50%) rotate(-45deg)!important', 'border-radius:2px!important',
            ].join(';');
            noSymbol.appendChild(slash);
            wrap.appendChild(noSymbol);

            const tint = document.createElement('div');
            tint.className = 'xrb-profile-no-symbol';
            tint.style.cssText = [
                'position:absolute!important', 'inset:0!important', 'border-radius:50%!important',
                'background:rgba(0,0,0,0.45)!important', 'z-index:9998!important', 'pointer-events:none!important',
            ].join(';');
            wrap.appendChild(tint);
        }
    }

    if (!document.querySelector('.xrb-profile-banner')) {
        const headerItems = document.querySelector('[data-testid="UserProfileHeader_Items"]');
        if (headerItems) {
            const banner = document.createElement('div');
            banner.className = 'xrb-banner xrb-profile-banner';
            banner.style.cssText = 'margin:8px 0;border-radius:0;';
            banner.innerHTML = `<span class="xrb-banner-icon">🚫</span><span class="xrb-banner-text">Blocked region: <strong>${escapeHtml(country)}</strong></span>`;
            headerItems.parentElement.insertBefore(banner, headerItems);
        }
    }
}

// ───────────────────────── Region labels ─────────────────────────
// Works anywhere an "@handle" is rendered: timeline, replies, profile header, follower lists,
// search, hover cards, notifications and the DM inbox/thread header.

let handleIO = null;
function getHandleIO() {
    if (handleIO) return handleIO;
    handleIO = new IntersectionObserver(entries => {
        entries.forEach(e => {
            if (!e.isIntersecting) return;
            handleIO.unobserve(e.target);
            delete e.target.dataset.xrbIo;                      // allow re-observe if the lookup got dropped
            const m = HANDLE_RE.exec((e.target.textContent || '').trim());
            if (m && !memCache.has(m[1].toLowerCase())) queueLookup(m[1]);
        });
    }, { rootMargin: '200px 0px' });
    return handleIO;
}

// Only X's real "Account based in" value is ever displayed
function labelInfo(u) {
    const e = memCache.get(u);
    return e && e.country ? { text: e.country } : null;
}

const labelOf = new WeakMap();   // handle <span> -> its label element

// Put the label in the same flex ROW as the handle (so it sits beside it, not under it):
// climb from the handle until the parent is a row-direction flex container.
function placeLabel(span, label) {
    let el = span.closest('a') || span;
    for (let i = 0; i < 5 && el.parentElement; i++) {
        const p = el.parentElement;
        const cs = getComputedStyle(p);
        if (cs.display.includes('flex') && cs.flexDirection.startsWith('row')) {
            el.insertAdjacentElement('afterend', label);
            return;
        }
        if (p.matches('[data-testid="User-Name"], [data-testid="UserName"], article')) break;
        el = p;
    }
    (span.closest('a') || span).insertAdjacentElement('afterend', label);
}

function decorateHandleEl(span) {
    const txt = span.textContent;
    if (!txt || txt.length > 16 || txt.charCodeAt(0) !== 64) return;
    const m = HANDLE_RE.exec(txt.trim());
    if (!m) return;
    const u = m[1].toLowerCase();
    if (SKIP.has(u)) return;

    const info = labelInfo(u);
    if (!info) {
        if (!span.dataset.xrbIo) { span.dataset.xrbIo = '1'; getHandleIO().observe(span); }
        return;
    }

    if (!span.parentElement) return;
    let label = labelOf.get(span);
    if (!label || !label.isConnected) {
        label = document.createElement('span');
        label.className = 'xrb-region-label';
        labelOf.set(span, label);
        placeLabel(span, label);
    }
    const shown = info.text.length > 28 ? info.text.slice(0, 27) + '…' : info.text;
    const text = '📍 ' + shown;
    if (label.textContent !== text) label.textContent = text;
    label.dataset.user = u;
    label.title = `Account based in: ${info.text}`;
    label.classList.toggle('xrb-region-label--blocked', isUserBlocked(u));
}

function decorateWithin(root) {
    if (!showLabels || !root || root.nodeType !== 1) return;
    if (root.matches && root.matches('div[dir="ltr"] > span')) decorateHandleEl(root);
    root.querySelectorAll('div[dir="ltr"] > span').forEach(decorateHandleEl);
}

// ───────────────────────── Article processing ─────────────────────────

function getUsernamesFromArticle(article) {
    const names = new Set();
    const add = href => {
        const m = (href || '').match(/^\/([A-Za-z0-9_]{1,15})(?:\/|\?|$)/);
        if (m && !SKIP.has(m[1].toLowerCase())) names.add(m[1].toLowerCase());
    };
    // Authors (tweet + quoted tweet), reposter line, and avatars (covers notifications: likers, followers…).
    // Deliberately NOT every link in the post — @mentions in the text no longer count.
    article.querySelectorAll(
        '[data-testid="User-Name"] a[href^="/"], [data-testid="UserName"] a[href^="/"], [data-testid="socialContext"] a[href^="/"]'
    ).forEach(a => add(a.getAttribute('href')));
    article.querySelectorAll('a[href^="/"] img[src*="profile_images"]').forEach(img => {
        const a = img.closest('a');
        if (a) add(a.getAttribute('href'));
    });
    return Array.from(names);
}

function getPrimaryAuthor(article) {
    const a = article.querySelector('[data-testid="User-Name"] a[href^="/"]');
    const m = a && (a.getAttribute('href') || '').match(/^\/([A-Za-z0-9_]{1,15})(?:\/|\?|$)/);
    return m ? m[1].toLowerCase() : '';
}

function getTweetIdsFromArticle(article) {
    const timeLink = article.querySelector('a[href*="/status/"] time');
    const primary = timeLink && timeLink.closest('a');
    const pm = primary && primary.getAttribute('href').match(/\/status\/(\d+)/);
    if (pm) return [pm[1]];                                      // the post itself, not a quoted one
    const ids = new Set();
    article.querySelectorAll('a[href*="/status/"]').forEach(link => {
        const m = link.getAttribute('href').match(/\/status\/(\d+)/);
        if (m) ids.add(m[1]);
    });
    return Array.from(ids);
}

const DOM_AFF_URL_RE = /(?:^|[/.])(?:amzn\.(?:to|eu|asia)|a\.co|s\.click\.aliexpress\.com|shope\.ee|linksynergy\.com|shareasale\.com|awin1\.com|hop\.clickbank\.net|go\.skimresources\.com|prf\.hn|tidd\.ly|geni\.us)(?:[/?]|$)/i;
const DOM_AFF_PARAM_RE = /[?&](?:aff|aff_id|affid|affiliate|affiliate_id|cjevent|irclickid)=|[?&]utm_medium=affiliate|amazon\.[a-z.]+\/\S*[?&]tag=/i;
const DOM_AFF_TEXT_RE = /#(?:ad|affiliate|sponsored|paidpartnership|commissionearned)\b|affiliate links?|commission (?:earned|link)/i;

// Fallback when the API payload wasn't seen (e.g. cached/prefetched responses)
function domLooksAffiliate(article) {
    const textEl = article.querySelector('[data-testid="tweetText"]');
    if (textEl && DOM_AFF_TEXT_RE.test(textEl.textContent || '')) return true;
    const links = article.querySelectorAll('[data-testid="tweetText"] a, [data-testid="card.wrapper"] a');
    for (const a of links) {
        const shown = a.textContent || '';
        const href = a.getAttribute('href') || '';
        if (DOM_AFF_URL_RE.test(shown) || DOM_AFF_PARAM_RE.test(shown) || DOM_AFF_URL_RE.test(href) || DOM_AFF_PARAM_RE.test(href)) return true;
    }
    return false;
}

function affiliateVerdict(article) {
    if (!blockAffiliate && !blockAffiliated) return null;
    const author = getPrimaryAuthor(article);
    if (author && isExempt(author)) return null;                 // mutuals are never affiliate-blocked either

    if (blockAffiliate) {
        if (getTweetIdsFromArticle(article).some(id => affiliateTweetIds.has(id))) return 'Affiliate Post';
        if (domLooksAffiliate(article)) return 'Affiliate Post';
        if (author && (affiliateUserCounts.get(author) || 0) >= AFFILIATE_USER_THRESHOLD) return 'Affiliate Account';
    }
    if (blockAffiliated && author && affiliatedUsers.has(author)) return 'Affiliated Account';
    return null;
}

function processArticle(article) {
    if (article.dataset.xrbTreated) return;
    decorateWithin(article);

    const verdict = affiliateVerdict(article);
    if (verdict) { applyTreatment(article, verdict); return; }

    if (article.dataset.xrbProcessed) return;
    const usernames = getUsernamesFromArticle(article);
    if (!usernames.length) return;

    let unknown = false;
    for (const u of usernames) {
        const why = blockReason(u);
        if (why) { applyTreatment(article, why); return; }
        if (!memCache.has(u)) { unknown = true; queueLookup(u); }
    }
    // On notifications/inbox we keep re-checking until relationship data arrives
    if (!unknown && !SENSITIVE_PATH.test(window.location.pathname)) article.dataset.xrbProcessed = 'true';
}

function rescanDOM() {
    document.querySelectorAll(ARTICLE_SEL).forEach(art => {
        if (art.dataset.xrbTreated) return;

        const verdict = affiliateVerdict(art);
        if (verdict) { applyTreatment(art, verdict); return; }

        if (art.dataset.xrbProcessed) return;
        for (const u of getUsernamesFromArticle(art)) {
            const why = blockReason(u);
            if (why) { applyTreatment(art, why); return; }
        }
    });
}

function scanAll() {
    document.querySelectorAll(ARTICLE_SEL).forEach(processArticle);
}

function clearVisualTreatments() {
    document.querySelectorAll('.xrb-banner, .xrb-red-circle, .xrb-overlay, .xrb-profile-no-symbol, .xrb-region-label').forEach(el => el.remove());
    document.querySelectorAll('[data-xrb-circle], [data-xrb-profile-circle]').forEach(el => {
        delete el.dataset.xrbCircle;
        delete el.dataset.xrbProfileCircle;
    });
    document.querySelectorAll(ARTICLE_SEL).forEach(el => {
        el.style.filter = '';
        el.style.opacity = '';
        el.style.display = '';
        el.style.pointerEvents = '';
        delete el.dataset.xrbProcessed;
        delete el.dataset.xrbTreated;
    });
}
