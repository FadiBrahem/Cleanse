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
    .xrb-red-circle::after {
      background: ${themeColor} !important;
    }
    .xrb-banner {
      background: linear-gradient(90deg, rgba(${rgb}, 0.12), rgba(${rgb}, 0.05)) !important;
      border-left-color: ${themeColor} !important;
      border-bottom-color: rgba(${rgb}, 0.2) !important;
      color: ${themeColor} !important;
    }
    @keyframes xrb-pulse {
      0%,100% { box-shadow: 0 0 0 2px rgba(${rgb}, 0.35) !important; }
      50%      { box-shadow: 0 0 0 4px rgba(${rgb}, 0.55) !important; }
    }
  `;
}

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
            'position:absolute!important',
            'top:0!important', 'left:0!important',
            'width:100%!important', 'height:100%!important',
            'background:rgba(0,0,0,0.90)!important',
            'z-index:9990!important',
            'pointer-events:none!important',
            'display:flex!important',
            'flex-direction:column!important',
            'align-items:center!important',
            'justify-content:center!important',
            'gap:6px!important',
            'border-radius:inherit!important',
        ].join(';');
        overlay.innerHTML = `
      <div style="width:30px;height:30px;border-radius:50%;border:3px solid ${themeColor};position:relative;flex-shrink:0;">
        <div style="position:absolute;top:50%;left:50%;width:130%;height:3px;background:${themeColor};transform:translate(-50%,-50%) rotate(-45deg);border-radius:2px;"></div>
      </div>
      <span style="font-size:11px;font-weight:600;color:rgba(255,255,255,0.7);letter-spacing:0.08em;text-transform:uppercase;font-family:-apple-system,sans-serif;">Blocked Region</span>
      <span style="font-size:12px;color:${themeColor};font-weight:500;font-family:-apple-system,sans-serif;">${escapeHtml(locationText)}</span>
    `;
        tweetCell.appendChild(overlay);
    }
}

function checkProfilePage() {
    const pathname = window.location.pathname;
    const pageMatch = pathname.match(/^\/([A-Za-z0-9_]+)(?:\/|$)/);
    if (!pageMatch) return;

    const username = pageMatch[1].toLowerCase();
    if (SKIP.has(username)) return;

    if (blockedUsernames.has(username)) {
        applyProfileBlock(username);
    } else if (!memCache.has(username) && !pendingUsernames.has(username)) {
        queueLookup(username);
    }
}

function applyProfileBlock(username) {
    const entry = memCache.get(username);
    const country = entry?.country || 'blocked region';

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
                'position:absolute!important',
                'inset:0!important',
                'border-radius:50%!important',
                'border:4px solid ' + themeColor + '!important',
                'z-index:9999!important',
                'pointer-events:none!important',
                'box-sizing:border-box!important',
                'animation:xrb-pulse 2s ease-in-out infinite!important',
            ].join(';');

            const slash = document.createElement('div');
            slash.style.cssText = [
                'position:absolute!important',
                'top:50%!important', 'left:50%!important',
                'width:135%!important', 'height:4px!important',
                'background:' + themeColor + '!important',
                'transform:translate(-50%,-50%) rotate(-45deg)!important',
                'border-radius:2px!important',
            ].join(';');
            noSymbol.appendChild(slash);
            wrap.appendChild(noSymbol);

            const tint = document.createElement('div');
            tint.style.cssText = [
                'position:absolute!important',
                'inset:0!important',
                'border-radius:50%!important',
                'background:rgba(0,0,0,0.45)!important',
                'z-index:9998!important',
                'pointer-events:none!important',
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

function getUsernamesFromArticle(article) {
    const names = new Set();
    const nameEls = article.querySelectorAll('[data-testid="UserName"] a[href^="/"]');
    nameEls.forEach(el => {
        const m = el.getAttribute('href').match(/^\/([A-Za-z0-9_]+)(?:\/|\?|$)/);
        if (m && !SKIP.has(m[1].toLowerCase())) names.add(m[1].toLowerCase());
    });
    for (const link of article.querySelectorAll('a[href^="/"]')) {
        const m = (link.getAttribute('href') || '').match(/^\/([A-Za-z0-9_]+)(?:\/|\?|$)/);
        if (m && !SKIP.has(m[1].toLowerCase())) names.add(m[1].toLowerCase());
    }
    return Array.from(names);
}

function applyRegionLabel(article, username, country) {
    if (!country) return;

    const nameEls = article.querySelectorAll('[data-testid="UserName"] a[href^="/"]');
    nameEls.forEach(el => {
        const m = el.getAttribute('href').match(/^\/([A-Za-z0-9_]+)(?:\/|\?|$)/);
        if (m && m[1].toLowerCase() === username) {
            const container = el.closest('[data-testid="UserName"]');
            if (container && !container.querySelector(`.xrb-region-label[data-user="${username}"]`)) {
                const label = document.createElement('span');
                label.className = 'xrb-region-label';
                label.dataset.user = username;
                label.style.cssText = `
                    display: inline-flex;
                    align-items: center;
                    margin-left: 6px;
                    padding: 0px 4px;
                    border-radius: 4px;
                    font-size: 11px;
                    font-weight: 500;
                    color: inherit;
                    opacity: 0.6;
                    border: 1px solid currentColor;
                    white-space: nowrap;
                    vertical-align: middle;
                `;
                label.textContent = `📍 ${escapeHtml(country)}`;

                const flexRow = container.querySelector('div[dir="ltr"]') || container.firstElementChild;
                if (flexRow) {
                    flexRow.appendChild(label);
                } else {
                    container.appendChild(label);
                }
            }
        }
    });
}

function getTweetIdsFromArticle(article) {
    const ids = new Set();
    const links = article.querySelectorAll('a[href*="/status/"]');
    for (const link of links) {
        const m = link.getAttribute('href').match(/\/status\/(\d+)/);
        if (m) ids.add(m[1]);
    }
    return Array.from(ids);
}

function processArticle(article) {
    if (article.dataset.xrbTreated) return;

    const tweetIds = getTweetIdsFromArticle(article);
    for (const tweetId of tweetIds) {
        if (blockAffiliate && affiliateTweetIds.has(tweetId)) {
            applyTreatment(article, 'Affiliate Content');
            return;
        }
    }

    if (article.dataset.xrbProcessed) return;

    const usernames = getUsernamesFromArticle(article);
    if (!usernames.length) return;

    let hasUnknownUsers = false;
    for (const username of usernames) {
        const cached = memCache.get(username);
        if (cached) {
            if (cached.country) {
                applyRegionLabel(article, username, cached.country);
            }
            const ttl = cached.country ? CACHE_TTL : NEG_TTL;
            if (Date.now() - cached.ts < ttl) {
                if (cached.country && isBlocked(cached.country)) {
                    applyTreatment(article, cached.country);
                    return;
                }
            } else {
                hasUnknownUsers = true;
                queueLookup(username);
            }
        } else {
            hasUnknownUsers = true;
            queueLookup(username);
        }
    }

    if (!hasUnknownUsers) {
        article.dataset.xrbProcessed = 'true';
    } else {
        article.dataset.xrbQueued = 'true';
    }
}

function rescanDOM() {
    document.querySelectorAll('article[data-testid="tweet"], article[role="article"]').forEach(art => {
        if (art.dataset.xrbTreated) return;

        const tweetIds = getTweetIdsFromArticle(art);
        for (const tweetId of tweetIds) {
            if (blockAffiliate && affiliateTweetIds.has(tweetId)) {
                applyTreatment(art, 'Affiliate Content');
                return;
            }
        }

        if (art.dataset.xrbProcessed) return;

        const usernames = getUsernamesFromArticle(art);
        for (const username of usernames) {
            const entry = memCache.get(username);
            if (entry && entry.country) {
                applyRegionLabel(art, username, entry.country);
            }
            if (blockedUsernames.has(username)) {
                applyTreatment(art, entry?.country || 'blocked region');
                return;
            }
        }
    });
}

function scanAll() {
    const articles = document.querySelectorAll('article[data-testid="tweet"], article[role="article"]');
    console.log('[XRB] scanAll found', articles.length, 'articles on', window.location.pathname);
    articles.forEach(processArticle);
}

function clearVisualTreatments() {
    document.querySelectorAll('.xrb-banner, .xrb-red-circle, .xrb-overlay, .xrb-profile-no-symbol, .xrb-region-label').forEach(el => el.remove());
    document.querySelectorAll('[data-xrb-circle], [data-xrb-profile-circle]').forEach(el => {
        delete el.dataset.xrbCircle;
        delete el.dataset.xrbProfileCircle;
    });
    document.querySelectorAll('article[data-testid="tweet"], article[role="article"]').forEach(el => {
        el.style.filter = '';
        el.style.opacity = '';
        el.style.display = '';
        el.style.pointerEvents = '';
        delete el.dataset.xrbDone;
        delete el.dataset.xrbProcessed;
        delete el.dataset.xrbTreated;
        delete el.dataset.xrbQueued;
    });
}
