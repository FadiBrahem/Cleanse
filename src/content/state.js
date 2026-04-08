const CHANNEL = '__xrb_data__';
const CACHE_KEY = 'xrb_location_cache_v2';
const CACHE_TTL = 30 * 24 * 60 * 60 * 1000;
const NEG_TTL = 3 * 24 * 60 * 60 * 1000;

// State
let blockedRegions = [];
let blockMode = 'overlay';
let blockAffiliate = false;
let themeColor = '#ff2222';
let memCache = new Map();
let blockedUsernames = new Set();
let pendingUsernames = new Set();
let affiliateTweetIds = new Set();

let rateLimitedUntil = 0;
let lastRequestTime = 0;
let backoffMs = 800;
const MAX_BACKOFF = 60000;
const MAX_CONCURRENT = 2;
let activeRequests = 0;

let aboutQueryHash = 'XRqGa7EeokUU5kppkh13EA';
const HASH_FALLBACKS = [
    'XRqGa7EeokUU5kppkh13EA',
    'G3KGOASz96M-Qu0nwmGXNg',
    'qW5u-DAuXpMEG0zA1F7UGQ',
    'SAMkL5y_N9pmahSw8yy6gA',
];

const BEARER = 'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';

const SKIP = new Set(['home', 'explore', 'notifications', 'messages', 'search',
    'settings', 'i', 'compose', 'intent', 'hashtag', 'about', 'following',
    'followers', 'lists', 'bookmarks', 'verified_followers', 'super_follows',
    'who_to_follow', 'topics', 'connect_people']);

let lastPath = '';

const lookupQueue = [];
const lookupQueueSet = new Set(); // O(1) duplicate check
const MAX_QUEUE_SIZE = 100;       // prevent unbounded growth on heavy pages
let queueRunning = false;

function isBlocked(text) {
    if (!text || !blockedRegions.length) return false;
    const t = text.toLowerCase().trim();
    return blockedRegions.some(r => t.includes(r));
}

function escapeHtml(s) {
    return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
