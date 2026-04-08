
(function () {
  'use strict';

  const CHANNEL = '__xrb_data__';

  function emit(type, payload) {
    window.dispatchEvent(new CustomEvent(CHANNEL, { detail: { type, payload } }));
  }



  const _fetch = window.fetch;
  window.fetch = async function (...args) {
    const res = await _fetch.apply(this, args);
    try {
      const url = typeof args[0] === 'string' ? args[0] : (args[0]?.url || '');
      if (isGraphQL(url)) {
        res.clone().json().then(data => handleJSON(url, data)).catch(() => { });
      }
    } catch (_) { }
    return res;
  };



  const OrigXHR = window.XMLHttpRequest;
  window.XMLHttpRequest = function (...args) {
    const xhr = new OrigXHR(...args);
    let _url = '';
    const _open = xhr.open.bind(xhr);
    xhr.open = function (m, u, ...rest) { _url = u; return _open(m, u, ...rest); };
    xhr.addEventListener('load', function () {
      try {
        if (isGraphQL(_url) && xhr.responseText) {
          handleJSON(_url, JSON.parse(xhr.responseText));
        }
      } catch (_) { }
    });
    return xhr;
  };

  Object.defineProperty(window.XMLHttpRequest, 'prototype', {
    get: () => OrigXHR.prototype
  });



  function isGraphQL(url) {
    return url && (url.includes('/i/api/graphql/') || url.includes('api.x.com/graphql/'));
  }



  function handleJSON(url, data) {
    if (!data || typeof data !== 'object') return;


    if (url.includes('AboutAccountQuery')) {
      const result = data?.data?.user_result_by_screen_name?.result;
      if (result) {
        const screenName = result?.legacy?.screen_name || result?.core?.name;
        const country = result?.about_profile?.account_based_in || '';
        if (screenName && country) {
          emit('about_country', { username: screenName.toLowerCase(), country });
          console.log('[XRB-INJECT] AboutAccountQuery:', screenName, '->', country);
        }
      }
      return;
    }


    const seen = new Set();
    walkForUsers(data, 0, seen);
  }


  function walkForUsers(obj, depth, seen) {
    if (!obj || typeof obj !== 'object' || depth > 20) return;

    if (obj.rest_id && obj.legacy) {
      if (obj.legacy.screen_name) {
        const username = obj.legacy.screen_name.toLowerCase();
        if (!seen.has(username)) {
          seen.add(username);
          const location = obj.legacy.location || '';
          emit('legacy_location', { username, location });
        }
      }
      if (typeof obj.legacy.full_text === 'string') {
        let isAffiliate = false;
        if (obj.affiliate_badge_details) {
          isAffiliate = true;
        } else if (obj.legacy.entities && Array.isArray(obj.legacy.entities.urls)) {
          for (const u of obj.legacy.entities.urls) {
            const exp = u.expanded_url || '';
            if (exp.includes('amzn.to') || exp.includes('tag=') || exp.match(/affiliate|ref=/i)) {
              isAffiliate = true;
            }
          }
        }
        if (isAffiliate) {
          emit('affiliate_tweet', { tweetId: obj.rest_id });
          console.log('[XRB-INJECT] Affiliate tweet detected:', obj.rest_id);
        }
      }
    }

    if (Array.isArray(obj)) {
      for (const item of obj) walkForUsers(item, depth + 1, seen);
    } else {
      for (const val of Object.values(obj)) {
        if (val && typeof val === 'object') walkForUsers(val, depth + 1, seen);
      }
    }
  }

  console.log('[XRB-INJECT] v1.0 fetch+XHR interceptors installed');

})();
