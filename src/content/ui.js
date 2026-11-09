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
    .xrb-followers-chip { color: ${followersColor} !important; font-size: ${followersSize}px !important; opacity: 1 !important; }
    .xrb-following-chip { color: ${followingColor} !important; font-size: ${followingSize}px !important; opacity: 1 !important; }
    @keyframes xrb-pulse {
      0%,100% { box-shadow: 0 0 0 2px rgba(${rgb}, 0.35); }
      50%      { box-shadow: 0 0 0 4px rgba(${rgb}, 0.55); }
    }
  `;
}

function detectOwnUsername() {
    const a = document.querySelector('a[data-testid="AppTabBar_Profile_Link"]');
    const m = a && (a.getAttribute('href') || '').match(/^\/([A-Za-z0-9_]+)/);
    if (m && ownUsername !== m[1].toLowerCase()) {
        ownUsername = m[1].toLowerCase();
        try { chrome.storage.local.set({ xrb_own: ownUsername }); } catch (e) { }
    }
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

// ───────────────────────── Labels & chips ─────────────────────────
// Region label, follower count and follow-back tag next to names/handles.
// Works anywhere an "@handle" is rendered; the follow-back tag and "not following back" count are timeline-only.

let handleIO = null;
function getHandleIO() {
    if (handleIO) return handleIO;
    handleIO = new IntersectionObserver(entries => {
        if (!alive()) { shutdown(); return; }
        entries.forEach(e => {
            if (!e.isIntersecting) return;
            handleIO.unobserve(e.target);
            delete e.target.dataset.xrbIo;                      // allow re-observe if the lookup got dropped
            const m = HANDLE_RE.exec((e.target.textContent || '').trim());
            if (m && !memCache.has(m[1].toLowerCase())) queueLookup(m[1]);
        });
    }, { rootMargin: '200px 0px' });
    teardown.push(() => handleIO && handleIO.disconnect());
    return handleIO;
}

// Keep it to the plain region/country name: drop "(Connected via …)"-style extras
function cleanRegion(s) {
    return String(s).replace(/\s*\(.*?\)\s*/g, ' ').replace(/connected via.*$/i, '').replace(/\s+/g, ' ').trim();
}

// Only X's real "Account based in" value is ever displayed
function labelInfo(u) {
    const e = memCache.get(u);
    if (!e || !e.country) return null;
    const text = cleanRegion(e.country);
    return text ? { text, raw: e.country } : null;
}

// One chip per user per post/cell: scope is the whole post, and any extras are removed on sight
function scopeFor(span) {
    return span.closest('article, [data-testid="cellInnerDiv"], [data-testid="UserCell"], [data-testid="conversation"], [role="dialog"], [data-testid="HoverCard"]')
        || span.closest('[data-testid="UserName"], [data-testid="User-Name"]')     // profile header (not inside an article)
        || span.parentElement;
}
function uniqueChip(scope, cls, u) {
    if (!scope) return null;
    const all = scope.querySelectorAll(`.${cls}[data-user="${u}"]`);
    for (let i = 1; i < all.length; i++) all[i].remove();
    return all[0] || null;
}

// "Doesn't follow you back": only an explicit followed_by=true counts as following you
function notFollowingBack(u) {
    if (!u || u === ownUsername) return false;
    const r = relCache.get(u);
    return !(r && r.followedBy === true);
}

// Put the chip in the same flex ROW as the anchor element (so it sits beside it, not under it):
// climb until the parent is a row-direction flex container.
function placeLabel(span, label, limit) {
    let el = span.closest('a') || span;
    if (limit && !limit.contains(el)) el = span;
    for (let i = 0; i < 5 && el.parentElement; i++) {
        const p = el.parentElement;
        if (limit && !limit.contains(p)) break;                     // never place outside the dedupe scope
        const cs = getComputedStyle(p);
        if (cs.display.includes('flex') && cs.flexDirection.startsWith('row')) {
            el.insertAdjacentElement('afterend', label);
            return;
        }
        if (p.matches('[data-testid="User-Name"], [data-testid="UserName"], article')) break;
        el = p;
    }
    const anchorEl = span.closest('a');
    (anchorEl && (!limit || limit.contains(anchorEl)) ? anchorEl : span).insertAdjacentElement('afterend', label);
}

function fmtCount(n) {
    if (n >= 1e9) return (n / 1e9).toFixed(n >= 1e10 ? 0 : 1).replace(/\.0$/, '') + 'B';
    if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace(/\.0$/, '') + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(n >= 1e4 ? 0 : 1).replace(/\.0$/, '') + 'K';
    return String(n);
}

// Timeline-style headers only: never on Following/Followers lists, user cells or DM lists
function chipContext(span) {
    if (LIST_PATH.test(window.location.pathname)) return false;
    if (span.closest('[data-testid="UserCell"], [data-testid="conversation"]')) return false;
    return !!span.closest('[data-testid="User-Name"]');
}

// 'follows' | 'not' | null (unknown / not applicable)
function relStatus(u) {
    if (!u || u === ownUsername) return null;
    const r = relCache.get(u);
    if (!r || typeof r.followedBy !== 'boolean') return null;
    if (relOnlyFollowing && r.following !== true) return null;
    return r.followedBy ? 'follows' : 'not';
}

// Follower count chip, placed right after the DISPLAY NAME (not the handle)
function decorateFollowers(span, u) {
    const cont = span.closest('[data-testid="User-Name"], [data-testid="UserName"]');
    if (!cont) return;
    const scope = scopeFor(span);
    let fChip = uniqueChip(scope, 'xrb-followers-chip', u);
    let gChip = uniqueChip(scope, 'xrb-following-chip', u);
    const n = followersCache.get(u);
    const g = followingCache.get(u);
    if (!countsKnown(u) && followersMode !== 'off' && chipContext(span) &&
        (followersMode === 'always' || notFollowingBack(u))) {
        const r = span.getBoundingClientRect();                        // only accounts near the screen
        if (r.bottom > -300 && r.top < window.innerHeight + 300) { queueFollowers(u); queueLookup(u); }
    }

    let want = false;
    if (followersMode === 'always') want = true;
    else if (followersMode === 'nofollowback') want = chipContext(span) && notFollowingBack(u);
    if (!want) { if (fChip) fChip.remove(); if (gChip) gChip.remove(); return; }

    const nameBlock = cont.firstElementChild;
    if (!nameBlock) return;
    const nameSpan = () => [...nameBlock.querySelectorAll('span')].find(s =>
        s.children.length === 0 && s.textContent.trim() && s.textContent.trim().charAt(0) !== '@');

    if (typeof n === 'number') {
        if (!fChip) {
            const ns = nameSpan();
            if (!ns) return;
            fChip = document.createElement('span');
            fChip.className = 'xrb-followers-chip';
            fChip.dataset.user = u;
            placeLabel(ns, fChip, scope);
        }
        const text = fmtCount(n) + ' followers';
        if (fChip.textContent !== text) fChip.textContent = text;
        fChip.title = `${n.toLocaleString()} followers`;
    } else if (fChip) fChip.remove();

    if (typeof g === 'number') {
        if (!gChip) {
            gChip = document.createElement('span');
            gChip.className = 'xrb-following-chip';
            gChip.dataset.user = u;
            if (fChip) fChip.insertAdjacentElement('afterend', gChip);
            else { const ns = nameSpan(); if (!ns) return; placeLabel(ns, gChip, scope); }
        }
        const text = fmtCount(g) + ' following';
        if (gChip.textContent !== text) gChip.textContent = text;
        gChip.title = `Follows ${g.toLocaleString()} accounts`;
    } else if (gChip) gChip.remove();
}

function decorateRelation(span, u) {
    if (!chipContext(span)) return;          // hidden/duplicate handle copies must not add OR remove the chip
    const holder = scopeFor(span);
    let chip = uniqueChip(holder, 'xrb-rel-chip', u);
    const st = showRelation ? relStatus(u) : null;
    if (!st) { if (chip) chip.remove(); return; }
    if (!chip) {
        chip = document.createElement('span');
        chip.className = 'xrb-rel-chip';
        chip.dataset.user = u;
        const lab = holder.querySelector(`.xrb-region-label[data-user="${u}"]`);
        if (lab) lab.insertAdjacentElement('afterend', chip); else placeLabel(span, chip, holder);
    }
    chip.classList.toggle('xrb-rel-chip--yes', st === 'follows');
    chip.classList.toggle('xrb-rel-chip--no', st === 'not');
    const text = st === 'follows' ? '✓ Follows you' : '✗ Not following you';
    if (chip.textContent !== text) chip.textContent = text;
}

function decorateHandleEl(span) {
    const txt = span.textContent;
    if (!txt || txt.length > 16 || txt.charCodeAt(0) !== 64) return;
    const m = HANDLE_RE.exec(txt.trim());
    if (!m) return;
    const u = m[1].toLowerCase();
    if (SKIP.has(u)) return;
    if (!span.parentElement) return;

    if (followersMode !== 'off') decorateFollowers(span, u);

    if (showLabels) {
        const info = labelInfo(u);
        if (!info) {
            if (!span.dataset.xrbIo) { span.dataset.xrbIo = '1'; getHandleIO().observe(span); }
        } else {
            const holder = scopeFor(span);
            let label = uniqueChip(holder, 'xrb-region-label', u);
            if (!label) {
                label = document.createElement('span');
                label.className = 'xrb-region-label';
                label.dataset.user = u;
                placeLabel(span, label, holder);
            }
            const shown = info.text.length > 28 ? info.text.slice(0, 27) + '…' : info.text;
            const text = '📍 ' + shown;
            if (label.textContent !== text) label.textContent = text;
            label.title = `Account based in: ${info.raw}`;
            label.classList.toggle('xrb-region-label--blocked', isUserBlocked(u));
        }
    }

    decorateRelation(span, u);
}

function decorateWithin(root) {
    if (!(showLabels || followersMode !== 'off' || showRelation) || !root || root.nodeType !== 1) return;
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
    document.querySelectorAll('.xrb-banner, .xrb-red-circle, .xrb-overlay, .xrb-profile-no-symbol, .xrb-region-label, .xrb-followers-chip, .xrb-following-chip, .xrb-rel-chip').forEach(el => el.remove());
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
