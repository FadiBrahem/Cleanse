const CHANNEL = '__xrb_data__';
const READY_EVENT = '__xrb_ready__';
const CACHE_KEY = 'xrb_location_cache_v3';   // v3: drops entries that may have come from free-text profile locations
const TEMPLATE_KEY = 'xrb_about_template_v1';
const REL_KEY = 'xrb_rel_cache_v1';
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
let showRelation = true;              // green "Follows you" / red "Not following you" (timeline only)
let relOnlyFollowing = true;          // ...only for accounts I follow
let themeColor = '#ff2222';
let labelColor = '#22c55e';      // region label colour (popup option)

// ── Runtime data ──
const memCache = new Map();          // username -> { country, ts, src }
const profileLoc = new Map();        // username -> self-written profile location (free text; blocking fallback only)
const relCache = new Map();          // username -> { following, followedBy }
const followersCache = new Map();    // username -> follower count
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

// UserByScreenName template (learned from X's own profile requests) — used only to fetch follower counts
const userTemplate = { hash: null, features: null, fieldToggles: null, variables: null };
let userRateLimitedUntil = 0;
const followersQueue = [];
const followersQueueSet = new Set();
const followersTried = new Set();
const followerStamps = [];
let followersRunning = false;
const FOLLOWERS_BUDGET = 60;                  // max follower lookups per 15 min
const FOLLOWERS_WINDOW = 15 * 60 * 1000;

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
const SENSITIVE_PATH = /^\/(notifications|messages|i\/chat)/;
const ARTICLE_SEL = 'article[data-testid="tweet"], article[role="article"]';

// ── Instance identity: after an extension reload the OLD content script keeps running in open tabs.
//    Each instance stamps the page; any instance that no longer owns the stamp (or lost chrome.runtime) shuts itself down.
const INSTANCE_ID = Date.now() + '-' + Math.random().toString(36).slice(2);
const teardown = [];
let dead = false;
function alive() {
    try { return !!chrome.runtime?.id && document.documentElement.dataset.xrbInstance === INSTANCE_ID; }
    catch (e) { return false; }
}
function shutdown() {
    if (dead) return;
    dead = true;
    teardown.forEach(f => { try { f(); } catch (e) { } });
    console.log('[XRB] stale instance shut down');
}

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
