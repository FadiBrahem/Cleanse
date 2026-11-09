// Cleanse (X Region Blocker) v1.5
// Built from modular src/ — edit src/content/*.js, then run: node build.js

(function () {
  'use strict';
  if (window.__xrbContentLoaded) return;   // guard against double injection
  window.__xrbContentLoaded = true;

  // ── state.js ──
  const CHANNEL = '__xrb_data__';
  const READY_EVENT = '__xrb_ready__';
  const CACHE_KEY = 'xrb_location_cache_v3';   // v3: drops entries that may have come from free-text profile locations
  const TEMPLATE_KEY = 'xrb_about_template_v1';
  const CACHE_TTL = 30 * 24 * 60 * 60 * 1000;
  const NEG_TTL = 3 * 24 * 60 * 60 * 1000;

  // ── Settings ──
  let blockedRegions = [];
  let blockedRegexes = [];
  let blockMode = 'overlay';
  let blockAffiliate = false;      // posts with affiliate links / disclosures (+ repeat offenders)
  let blockAffiliated = false;     // accounts wearing an X "affiliated with" badge
  let whitelistMode = 'mutuals';   // 'mutuals' | 'following' | 'none'
  let showLabels = true;
  let followersMode = 'nofollowback';   // 'nofollowback' | 'always' | 'off'
  let showRelation = true;               // green "Follows you" / red "Not following you" (timeline only)
  let relOnlyFollowing = true;           // ...only for accounts I follow
  let themeColor = '#ff2222';
  let labelColor = '#22c55e';      // region label colour (popup option)

  // ── Runtime data ──
  const memCache = new Map();          // username -> { country, ts, src }
  const profileLoc = new Map();        // username -> self-written profile location (free text)
  const relCache = new Map();
  const followersCache = new Map();   // username -> follower count          // username -> { following, followedBy }
  const affiliatedUsers = new Set();
  const affiliateUserCounts = new Map();
  const affiliateTweetIds = new Set();
  const pendingUsernames = new Set();
  const AFFILIATE_USER_THRESHOLD = 3;  // affiliate posts seen before the whole account counts
  let ownUsername = '';

  // ── Rate limiting (kept deliberately gentle: X rate-limits AboutAccountQuery hard,
  //    and that limit is shared with X's own "About this account" screen) ──
  const BASE_INTERVAL = 2000;
  const MAX_BACKOFF = 60000;
  const MAX_CONCURRENT = 1;
  let backoffMs = BASE_INTERVAL;
  let rateLimitedUntil = 0;
  let activeRequests = 0;
  let nativeAboutAt = 0;               // last time X itself called/showed AboutAccountQuery

  const aboutTemplate = {
      hash: 'XRqGa7EeokUU5kppkh13EA',   // last-resort default; real hash is learned from X's traffic / bundle
      features: null,
      fieldToggles: null
  };

  const BEARER = 'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';

  const SKIP = new Set(['home', 'explore', 'notifications', 'messages', 'search',
      'settings', 'i', 'compose', 'intent', 'hashtag', 'about', 'following',
      'followers', 'lists', 'bookmarks', 'verified_followers', 'super_follows',
      'who_to_follow', 'topics', 'connect_people', 'jobs', 'communities', 'premium']);

  const HANDLE_RE = /^@([A-Za-z0-9_]{1,15})$/;
  const LIST_PATH = /^\/[^/]+\/(following|followers|verified_followers|followers_you_follow)\/?$/;
  const REL_KEY = 'xrb_rel_cache_v1';
  const SENSITIVE_PATH = /^\/(notifications|messages|i\/chat)/;
  const ARTICLE_SEL = 'article[data-testid="tweet"], article[role="article"]';

  let lastPath = '';

  const lookupQueue = [];
  const lookupQueueSet = new Set();
  const MAX_QUEUE_SIZE = 60;
  let queueRunning = false;

  // ── helpers ──
  function escapeRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  function compileRegions() {
      // word-boundary match: "india" no longer matches "indiana", "niger" no longer matches "nigeria"
      blockedRegexes = blockedRegions.map(r => new RegExp('(?:^|[^a-z0-9])' + escapeRegex(r) + '(?:$|[^a-z0-9])', 'i'));
  }

  function isBlocked(text) {
      if (!text || !blockedRegexes.length) return false;
      const t = String(text).trim();
      return blockedRegexes.some(re => re.test(t));
  }

  function relKnown(u) {
      const r = relCache.get(u);
      if (!r) return false;
      if (whitelistMode === 'following') return typeof r.following === 'boolean';
      return typeof r.following === 'boolean' && typeof r.followedBy === 'boolean';
  }

  // Accounts that are never blocked: yourself, and (per setting) mutuals / accounts you follow
  function isExempt(u) {
      if (!u) return false;
      if (ownUsername && u === ownUsername) return true;
      if (whitelistMode === 'none') return false;
      const r = relCache.get(u);
      if (!r) return false;
      if (whitelistMode === 'following') return r.following === true;
      return r.following === true && r.followedBy === true;
  }

  // Returns true when this update changes what we should do with the account
  function updateRel(u, following, followedBy) {
      const key = () => `${isExempt(u)}|${relKnown(u)}`;
      const before = key();
      const prev = relCache.get(u) || {};
      relCache.set(u, {
          following: typeof following === 'boolean' ? following : prev.following,
          followedBy: typeof followedBy === 'boolean' ? followedBy : prev.followedBy
      });
      persistRel(u);
      return before !== key();
  }

  // Returns the matched region text if this account should be blocked, else ''.
  // "Account based in" (from X) is authoritative; the free-text profile location is only a fallback for BLOCKING
  // when X has no region for the account. It is never shown as a label.
  function blockReason(u) {
      const e = memCache.get(u);
      let reason = '';
      if (e && e.country) {
          if (isBlocked(e.country)) reason = e.country;
      } else {
          const p = profileLoc.get(u);
          if (p && isBlocked(p)) reason = p;
      }
      if (!reason) return '';
      if (isExempt(u)) return '';
      // In notifications/inbox we don't hide an account until we KNOW it isn't someone you follow
      if (whitelistMode !== 'none' && !relKnown(u) && SENSITIVE_PATH.test(window.location.pathname)) return '';
      return reason;
  }

  function isUserBlocked(u) { return !!blockReason(u); }

  function escapeHtml(s) {
      return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }


  // ── cache.js ──
  const pendingDisk = new Map();
  const pendingRel = new Map();
  let relTimer = null;
  let diskTimer = null;
  let refreshTimer = null;
  let fullRefreshTimer = null;

  async function loadDiskCache() {
      try {
          const stored = await chrome.storage.local.get([CACHE_KEY, TEMPLATE_KEY]);
          const raw = stored[CACHE_KEY] || {};
          const now = Date.now();
          let loaded = 0;
          for (const [username, entry] of Object.entries(raw)) {
              const ttl = entry.country ? CACHE_TTL : NEG_TTL;
              if (now - entry.ts < ttl) { memCache.set(username, entry); loaded++; }
          }
          try {
              const rs = (await chrome.storage.local.get(REL_KEY))[REL_KEY] || {};
              for (const [u, e] of Object.entries(rs)) {
                  if (now - e.ts < 7 * 24 * 60 * 60 * 1000) relCache.set(u, { following: e.f, followedBy: e.fb });
              }
          } catch (e) { }
          const t = stored[TEMPLATE_KEY];
          if (t && t.hash) {
              aboutTemplate.hash = t.hash;
              aboutTemplate.features = t.features || null;
              aboutTemplate.fieldToggles = t.fieldToggles || null;
          }
          console.log('[XRB] Cache loaded:', loaded, 'entries');
      } catch (e) { }
  }

  // Follow relationships learned from X's data or from your Following/Followers pages (kept 7 days)
  function persistRel(u) {
      const r = relCache.get(u);
      if (!r || typeof r.followedBy !== 'boolean') return;
      pendingRel.set(u, { f: r.following, fb: r.followedBy, ts: Date.now() });
      if (!relTimer) relTimer = setTimeout(flushRel, 4000);
  }

  async function flushRel() {
      relTimer = null;
      if (!pendingRel.size) return;
      const batch = [...pendingRel];
      pendingRel.clear();
      try {
          let raw = (await chrome.storage.local.get(REL_KEY))[REL_KEY] || {};
          for (const [u, e] of batch) raw[u] = e;
          if (Object.keys(raw).length > 6000) {
              raw = Object.fromEntries(Object.entries(raw).sort((a, b) => b[1].ts - a[1].ts).slice(0, 4500));
          }
          await chrome.storage.local.set({ [REL_KEY]: raw });
      } catch (e) { }
  }

  function saveTemplate() {
      try { chrome.storage.local.set({ [TEMPLATE_KEY]: { ...aboutTemplate } }); } catch (e) { }
  }

  // Writes are batched: one read-modify-write per 3s instead of one per lookup
  function saveToDiskCache(username, country, src) {
      pendingDisk.set(username, { country: country || '', ts: Date.now(), src: src || 'about' });
      if (!diskTimer) diskTimer = setTimeout(flushDiskCache, 3000);
  }

  async function flushDiskCache() {
      diskTimer = null;
      if (!pendingDisk.size) return;
      const batch = [...pendingDisk];
      pendingDisk.clear();
      try {
          const stored = await chrome.storage.local.get(CACHE_KEY);
          let raw = stored[CACHE_KEY] || {};
          for (const [u, e] of batch) raw[u] = e;
          if (Object.keys(raw).length > 8000) {
              raw = Object.fromEntries(Object.entries(raw).sort((a, b) => b[1].ts - a[1].ts).slice(0, 6000));
          }
          await chrome.storage.local.set({ [CACHE_KEY]: raw });
      } catch (e) { }
  }

  function cacheResult(username, country, src) {
      const lower = username.toLowerCase();
      memCache.set(lower, { country: country || '', ts: Date.now(), src: src || 'about' });
      saveToDiskCache(lower, country, src);
      scheduleRefresh();
  }

  // Cheap, debounced: apply treatments to new matches + refresh region labels
  function scheduleRefresh() {
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => {
          if (blockedRegions.length) rescanDOM();
          decorateWithin(document.body);
          checkProfilePage();
      }, 120);
  }

  // Heavier: used when an account's exemption status flips (e.g. we learn you follow each other)
  function scheduleFullRefresh() {
      clearTimeout(fullRefreshTimer);
      fullRefreshTimer = setTimeout(() => {
          clearVisualTreatments();
          scanAll();
          decorateWithin(document.body);
          checkProfilePage();
      }, 300);
  }


  // ── api.js ──
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


  // ── ui.js ──
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
  // Keep it to the plain region/country name: drop "(Connected via …)"-style extras
  function cleanRegion(s) {
      return String(s).replace(/\s*\(.*?\)\s*/g, ' ').replace(/connected via.*$/i, '').replace(/\s+/g, ' ').trim();
  }

  function labelInfo(u) {
      const e = memCache.get(u);
      if (!e || !e.country) return null;
      const text = cleanRegion(e.country);
      return text ? { text, raw: e.country } : null;
  }

  // X renders the handle more than once per header; one chip/label per user per header
  function containerFor(span) {
      return span.closest('[data-testid="User-Name"], [data-testid="UserName"], [data-testid="UserCell"], [data-testid="conversation"], article')
          || span.parentElement;
  }

  const labelOf = new WeakMap();   // handle <span> -> its region label element
  const chipOf = new WeakMap();    // handle <span> -> its followers chip element

  function fmtCount(n) {
      if (n >= 1e9) return (n / 1e9).toFixed(n >= 1e10 ? 0 : 1).replace(/\.0$/, '') + 'B';
      if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace(/\.0$/, '') + 'M';
      if (n >= 1e3) return (n / 1e3).toFixed(n >= 1e4 ? 0 : 1).replace(/\.0$/, '') + 'K';
      return String(n);
  }

  // Follower count chip, placed right after the DISPLAY NAME (not the handle)
  function decorateFollowers(span, u) {
      const cont = span.closest('[data-testid="User-Name"], [data-testid="UserName"]');
      if (!cont) return;
      let chip = cont.querySelector(`.xrb-followers-chip[data-user="${u}"]`);
      const n = followersCache.get(u);

      let want = false;
      if (typeof n === 'number') {
          if (followersMode === 'always') want = true;
          else if (followersMode === 'nofollowback') want = chipContext(span) && relStatus(u) === 'not';
      }
      if (!want) { if (chip) chip.remove(); return; }

      const nameBlock = cont.firstElementChild;
      if (!nameBlock) return;
      if (!chip) {
          const nameSpan = [...nameBlock.querySelectorAll('span')].find(s =>
              s.children.length === 0 && s.textContent.trim() && s.textContent.trim().charAt(0) !== '@');
          if (!nameSpan) return;
          chip = document.createElement('span');
          chip.className = 'xrb-followers-chip';
          chip.dataset.user = u;
          placeLabel(nameSpan, chip);
      }
      const text = '👥 ' + fmtCount(n);
      if (chip.textContent !== text) chip.textContent = text;
      chip.title = `${n.toLocaleString()} followers`;
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

  function decorateRelation(span, u) {
      const holder = containerFor(span);
      let chip = holder.querySelector(`.xrb-rel-chip[data-user="${u}"]`);
      const st = showRelation && chipContext(span) ? relStatus(u) : null;
      if (!st) { if (chip) chip.remove(); return; }
      if (!chip) {
          chip = document.createElement('span');
          chip.className = 'xrb-rel-chip';
          chip.dataset.user = u;
          const lab = holder.querySelector(`.xrb-region-label[data-user="${u}"]`);
          if (lab) lab.insertAdjacentElement('afterend', chip); else placeLabel(span, chip);
      }
      chip.classList.toggle('xrb-rel-chip--yes', st === 'follows');
      chip.classList.toggle('xrb-rel-chip--no', st === 'not');
      const text = st === 'follows' ? '✓ Follows you' : '✗ Not following you';
      if (chip.textContent !== text) chip.textContent = text;
  }

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
      if (!span.parentElement) return;

      if (followersMode !== 'off') decorateFollowers(span, u);

      if (showLabels) {
          const info = labelInfo(u);
          if (!info) {
              if (!span.dataset.xrbIo) { span.dataset.xrbIo = '1'; getHandleIO().observe(span); }
          } else {
              const holder = containerFor(span);
              let label = holder.querySelector(`.xrb-region-label[data-user="${u}"]`);
              if (!label) {
                  label = document.createElement('span');
                  label.className = 'xrb-region-label';
                  label.dataset.user = u;
                  placeLabel(span, label);
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
      document.querySelectorAll('.xrb-banner, .xrb-red-circle, .xrb-overlay, .xrb-profile-no-symbol, .xrb-region-label, .xrb-followers-chip, .xrb-rel-chip').forEach(el => el.remove());
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


  // ── observers.js ──
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
      return !!c && (c.contains('xrb-region-label') || c.contains('xrb-followers-chip') || c.contains('xrb-rel-chip') || c.contains('xrb-overlay') || c.contains('xrb-red-circle') ||
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
          learnRelFromList();

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


  // ── unfollow.js ──
  // ───────────── Unfollow non-followers (runs only on YOUR Following page, started from the popup) ─────────────
  // Language-independent: uses X's data-testids first; localized texts are only a fallback.
  const UNF_TEXTS = {
      followsYou: ['Follows you', 'Te sigue', 'Segue você', 'Mengikuti Kamu', 'Seni takip ediyor', 'Vous suit', 'Folgt dir', 'يتابعك'],
      following: ['Following', 'Siguiendo', 'Seguindo', 'Mengikuti', 'Takip ediliyor', 'Abonné', 'Abonnement', 'Folge ich', 'Gefolgt', 'متابَع'],
      unfollow: ['Unfollow', 'Dejar de seguir', 'Deixar de Seguir', 'Tidak Mengikuti', 'Takibi bırak', 'Ne plus suivre', 'Entfolgen', 'إلغاء المتابعة']
  };
  const unf = { running: false, stop: false, done: 0, panel: null };

  function unfCellUsername(cell) {
      const a = cell.querySelector('a[href^="/"]');
      const m = a && (a.getAttribute('href') || '').match(/^\/([A-Za-z0-9_]{1,15})(?:\/|\?|$)/);
      return m && !SKIP.has(m[1].toLowerCase()) ? m[1].toLowerCase() : '';
  }

  function unfCellFollowsYou(cell) {
      if (cell.querySelector('[data-testid="userFollowIndicator"]')) return true;
      return [...cell.querySelectorAll('span')].some(s => UNF_TEXTS.followsYou.includes(s.textContent.trim()));
  }

  // Passively learn who follows you whenever you open YOUR Following / Followers page
  function learnRelFromList() {
      const m = window.location.pathname.match(/^\/([A-Za-z0-9_]+)\/(following|followers)\/?$/);
      if (!m || !ownUsername || m[1].toLowerCase() !== ownUsername) return;
      const onFollowing = m[2] === 'following';
      document.querySelectorAll('[data-testid="UserCell"]').forEach(cell => {
          const u = unfCellUsername(cell);
          if (!u) return;
          if (onFollowing) updateRel(u, true, unfCellFollowsYou(cell));
          else updateRel(u, !!cell.querySelector('[data-testid$="-unfollow"]'), true);
      });
  }

  function unfPanel(text, opts = {}) {
      if (!unf.panel) {
          const p = document.createElement('div');
          p.id = 'xrb-unfollow-panel';
          p.style.cssText = 'position:fixed;left:16px;bottom:16px;z-index:2147483647;background:#111;color:#eee;border:1px solid #333;border-radius:10px;padding:10px 12px;font:13px -apple-system,Segoe UI,sans-serif;display:flex;gap:10px;align-items:center;box-shadow:0 4px 20px rgba(0,0,0,.5)';
          p.innerHTML = '<span class="t"></span><button style="background:#ff2222;color:#fff;border:0;border-radius:6px;padding:4px 10px;cursor:pointer;font-weight:600"></button>';
          document.body.appendChild(p);
          unf.panel = p;
      }
      const btn = unf.panel.querySelector('button');
      unf.panel.querySelector('.t').textContent = text;
      btn.textContent = opts.finished ? 'Close' : 'Stop';
      btn.onclick = () => {
          if (opts.finished) { unf.panel.remove(); unf.panel = null; } else unf.stop = true;
      };
  }

  function unfRand(a, b) { return a + Math.random() * (b - a); }

  async function unfollowCell(cell) {
      cell.scrollIntoView({ block: 'center' });
      await sleep(250);
      const btn = cell.querySelector('[data-testid$="-unfollow"]')
          || [...cell.querySelectorAll('[role="button"]')].find(b => UNF_TEXTS.following.includes(b.textContent.trim()));
      if (!btn) return false;
      btn.click();
      for (let i = 0; i < 20; i++) {                                  // wait up to ~3s for the confirm dialog
          await sleep(150);
          const confirmBtn = document.querySelector('[data-testid="confirmationSheetConfirm"]')
              || [...document.querySelectorAll('[role="button"]')].find(b => UNF_TEXTS.unfollow.includes(b.textContent.trim()));
          if (confirmBtn) { confirmBtn.click(); await sleep(400); return true; }
      }
      return false;
  }

  async function runUnfollow(max, skip) {
      const processed = new Set();
      let idle = 0, failures = 0, reason = 'Finished';
      window.scrollTo(0, 0);
      await sleep(800);
      try {
          while (!unf.stop && unf.done < max) {
              let newSeen = 0;
              for (const cell of document.querySelectorAll('[data-testid="UserCell"]')) {
                  if (unf.stop || unf.done >= max) break;
                  const u = unfCellUsername(cell);
                  if (!u || processed.has(u)) continue;
                  processed.add(u);
                  newSeen++;
                  if (skip.has(u)) continue;
                  const follows = unfCellFollowsYou(cell);
                  updateRel(u, true, follows);
                  if (follows) continue;                              // mutual: keep
                  if (await unfollowCell(cell)) {
                      unf.done++;
                      failures = 0;
                      unfPanel(`Unfollowed ${unf.done}${max < Infinity ? ' / ' + max : ''}…`);
                      await sleep(unfRand(1800, 3800));               // human pace: avoids X's action limits
                  } else if (++failures >= 3) {
                      unf.stop = true;
                      reason = 'Stopped: unfollow button/confirm not found 3×';
                  }
              }
              if (unf.stop) break;
              window.scrollBy(0, Math.round(window.innerHeight * 0.8));
              await sleep(1200);
              const atBottom = window.innerHeight + window.scrollY >= document.body.scrollHeight - 80;
              idle = newSeen === 0 && atBottom ? idle + 1 : 0;
              if (idle >= 3) break;
          }
          if (unf.stop && reason === 'Finished') reason = 'Stopped';
      } finally {
          unf.running = false;
          unfPanel(`${reason}: unfollowed ${unf.done} non-follower${unf.done === 1 ? '' : 's'}.`, { finished: true });
      }
  }

  function startUnfollow(opts) {
      if (unf.running) return { ok: false, error: 'Already running' };
      detectOwnUsername();
      const m = window.location.pathname.match(/^\/([A-Za-z0-9_]+)\/following\/?$/);
      if (!m || (ownUsername && m[1].toLowerCase() !== ownUsername)) return { ok: false, error: 'Open YOUR Following page' };
      unf.running = true;
      unf.stop = false;
      unf.done = 0;
      const max = opts.max > 0 ? opts.max : Infinity;
      const skip = new Set((opts.skip || []).map(s => String(s).toLowerCase().replace(/^@/, '').trim()).filter(Boolean));
      unfPanel('Starting…');
      runUnfollow(max, skip);
      return { ok: true };
  }

  function initUnfollowListener() {
      chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
          if (!msg || !msg.type) return;
          if (msg.type === 'XRB_UNFOLLOW_START') { sendResponse(startUnfollow(msg)); return; }
          if (msg.type === 'XRB_UNFOLLOW_STOP') { unf.stop = true; sendResponse({ ok: true }); return; }
          if (msg.type === 'XRB_UNFOLLOW_STATUS') { sendResponse({ running: unf.running, done: unf.done }); return; }
      });
  }


  // ── main.js ──
  function loadSettings(cb) {
      chrome.storage.sync.get(
          ['blockedRegions', 'blockMode', 'blockAffiliate', 'blockAffiliated', 'whitelistMode', 'showLabels', 'themeColor', 'labelColor', 'showFollowers', 'followersMode', 'showRelation', 'relOnlyFollowing'],
          data => {
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
      if (area !== 'sync') return;
      const keys = ['blockedRegions', 'blockMode', 'blockAffiliate', 'blockAffiliated', 'whitelistMode', 'showLabels', 'themeColor', 'labelColor', 'followersMode', 'showRelation', 'relOnlyFollowing'];
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
          let msg = e.detail;
          try { if (typeof msg === 'string') msg = JSON.parse(msg); } catch (_) { return; }
          const { type, payload } = msg || {};
          if (!type || !payload) return;

          switch (type) {
              case 'user_info': {
                  const { username, location, following, followedBy, affiliated, followers } = payload;
                  if (typeof followers === 'number') followersCache.set(username, followers);
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
                  if (payload.hash) {
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
      await loadDiskCache();
      loadSettings(() => {
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
      });
      console.log('[XRB] v1.1 ready');
  }

  init();


})();
