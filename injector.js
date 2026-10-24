// Runs in the page's MAIN world. Passively reads X's own GraphQL responses and
// forwards compact facts to the content script. Makes NO requests of its own.
(function () {
  'use strict';
  if (window.__xrbInjectorLoaded) return;
  window.__xrbInjectorLoaded = true;

  const CHANNEL = '__xrb_data__';
  const READY = '__xrb_ready__';
  const MAX_BUFFER = 400;
  let ready = false;
  const buffer = [];

  function dispatch(type, payload) {
    // JSON string: safest way to cross the MAIN -> ISOLATED world boundary
    window.dispatchEvent(new CustomEvent(CHANNEL, { detail: JSON.stringify({ type, payload }) }));
  }
  function emit(type, payload) {
    if (ready) return dispatch(type, payload);
    buffer.push([type, payload]);               // content script isn't listening yet (document_start vs document_idle)
    if (buffer.length > MAX_BUFFER) buffer.shift();
  }
  window.addEventListener(READY, () => {
    ready = true;
    buffer.splice(0).forEach(([t, p]) => dispatch(t, p));
  });

  // ── Affiliate detection ─────────────────────────────────────────────
  const AFF_URL_RE = /(?:^|[/.])(?:amzn\.(?:to|eu|asia)|a\.co|s\.click\.aliexpress\.com|shope\.ee|linksynergy\.com|shareasale\.com|awin1\.com|hop\.clickbank\.net|go\.skimresources\.com|prf\.hn|jdoqocy\.com|anrdoezrs\.net|tkqlhce\.com|kqzyfj\.com|dpbolvw\.net|tidd\.ly|geni\.us)(?:[/?]|$)/i;
  const AFF_PARAM_RE = /[?&](?:aff|aff_id|affid|affiliate|affiliate_id|aff_fcid|aff_platform|cjevent|irclickid)=|[?&]utm_medium=affiliate|amazon\.[a-z.]+\/\S*[?&]tag=|amazon\.[a-z.]+\/\S*(?:\/ref=|[?&]ref=)/i;
  const AFF_TEXT_RE = /#(?:ad|affiliate|sponsored|paidpartnership|commissionearned)\b|affiliate links?|commission (?:earned|link)|paid partnership/i;

  function isAffiliateTweet(t) {
    const legacy = t.legacy || {};
    const note = t.note_tweet?.note_tweet_results?.result;
    const text = note?.text || legacy.full_text || '';
    if (AFF_TEXT_RE.test(text)) return true;
    const urls = [...(legacy.entities?.urls || []), ...(note?.entity_set?.urls || [])];
    for (const u of urls) {
      const e = u.expanded_url || '';
      if (AFF_URL_RE.test(e) || AFF_PARAM_RE.test(e)) return true;
    }
    return false;
  }

  // ── User extraction (handles both old `legacy` and new `core` schemas) ──
  function userFrom(o) {
    if (!o || typeof o !== 'object') return null;
    const isGql = o.rest_id && (o.__typename === 'User' || o.core?.screen_name || o.legacy?.screen_name);
    const isRest = typeof o.screen_name === 'string' && (o.id_str || o.id) && ('following' in o || 'location' in o);
    if (!isGql && !isRest) return null;
    const username = String(o.core?.screen_name || o.legacy?.screen_name || o.screen_name || '').toLowerCase();
    if (!username) return null;
    const loc = typeof o.location === 'string' ? o.location : (o.location?.location ?? o.legacy?.location ?? '');
    const rp = o.relationship_perspectives || {};
    const bool = v => (typeof v === 'boolean' ? v : undefined);
    const lab = o.affiliates_highlighted_label;
    return {
      username,
      location: typeof loc === 'string' ? loc : '',
      following: bool(rp.following ?? o.legacy?.following ?? o.following),
      followedBy: bool(rp.followed_by ?? o.legacy?.followed_by ?? o.followed_by),
      affiliated: !!(lab && typeof lab === 'object' && Object.keys(lab).length)
    };
  }

  // ── GraphQL helpers ─────────────────────────────────────────────────
  function isGraphQL(url) { return !!url && url.includes('/graphql/'); }

  function parseGql(url) {
    try {
      const u = new URL(url, location.origin);
      const m = u.pathname.match(/\/graphql\/([^/]+)\/([^/?]+)/);
      return m ? { hash: m[1], op: m[2], u } : null;
    } catch (_) { return null; }
  }

  function learnTemplate(g) {
    if (g.op !== 'AboutAccountQuery') return;
    emit('query_template', {
      op: g.op,
      hash: g.hash,
      features: g.u.searchParams.get('features'),
      fieldToggles: g.u.searchParams.get('fieldToggles')
    });
  }

  function screenNameFromUrl(g) {
    try { return String(JSON.parse(g.u.searchParams.get('variables')).screenName || '').toLowerCase(); }
    catch (_) { return ''; }
  }

  function handleJSON(url, data) {
    if (!data || typeof data !== 'object') return;
    const g = parseGql(url);

    if (g && g.op === 'AboutAccountQuery') {
      const result = data?.data?.user_result_by_screen_name?.result;
      const country = result?.about_profile?.account_based_in || '';
      const sn = screenNameFromUrl(g) || userFrom(result)?.username || '';
      if (sn && country) emit('about_country', { username: sn, country });
    }

    const seenUsers = new Set();
    const seenTweets = new Set();
    walk(data, 0, seenUsers, seenTweets);
  }

  function walk(obj, depth, seenUsers, seenTweets) {
    if (!obj || typeof obj !== 'object' || depth > 25) return;

    if (!Array.isArray(obj)) {
      const u = userFrom(obj);
      if (u && !seenUsers.has(u.username)) {
        seenUsers.add(u.username);
        emit('user_info', u);
      }
      if (obj.rest_id && typeof obj.legacy?.full_text === 'string' && !seenTweets.has(obj.rest_id)) {
        seenTweets.add(obj.rest_id);
        if (isAffiliateTweet(obj)) {
          const author = userFrom(obj.core?.user_results?.result);
          emit('affiliate_tweet', { tweetId: obj.rest_id, username: author ? author.username : '' });
        }
      }
    }

    const vals = Array.isArray(obj) ? obj : Object.values(obj);
    for (const v of vals) if (v && typeof v === 'object') walk(v, depth + 1, seenUsers, seenTweets);
  }

  // ── fetch: return X's ORIGINAL promise untouched; observe on the side ──
  const _fetch = window.fetch;
  window.fetch = function (...args) {
    const p = _fetch.apply(this, args);
    try {
      const url = args[0]?.url || String(args[0] || '');
      if (isGraphQL(url)) {
        const g = parseGql(url);
        if (g) learnTemplate(g);
        p.then(res => {
          try {
            if (g && g.op === 'AboutAccountQuery') emit('about_native', { status: res.status });
            if (res.ok) res.clone().json().then(d => handleJSON(url, d)).catch(() => { });
          } catch (_) { }
        }).catch(() => { });
      }
    } catch (_) { }
    return p;
  };

  // ── XHR: patch the prototype (don't replace the constructor) ────────
  const xOpen = XMLHttpRequest.prototype.open;
  const xSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    try { this.__xrbUrl = String(url); } catch (_) { }
    return xOpen.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.send = function (...a) {
    const url = this.__xrbUrl;
    if (isGraphQL(url)) {
      this.addEventListener('load', () => {
        try {
          const d = this.responseType === 'json' ? this.response
            : (this.responseType === '' || this.responseType === 'text') ? JSON.parse(this.responseText) : null;
          if (d) handleJSON(url, d);
        } catch (_) { }
      });
    }
    return xSend.apply(this, a);
  };
})();
