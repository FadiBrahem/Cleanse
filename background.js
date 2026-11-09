'use strict';

// The manifest already injects injector.js / content.js on every X page load.
// The service worker only covers tabs that were open BEFORE the extension was installed/reloaded.
// Both scripts have re-entry guards; a newer content script also takes over from (and stops) older instances.
async function injectIntoExistingTabs() {
  try {
    const tabs = await chrome.tabs.query({ url: ['https://x.com/*', 'https://twitter.com/*'] });
    for (const tab of tabs) {
      if (!tab.id) continue;
      try {
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['injector.js'], world: 'MAIN' });
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'], world: 'ISOLATED' });
        await chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ['content.css'] });
      } catch (e) {
        console.log('[XRB-BG] inject skipped for tab', tab.id, e.message);
      }
    }
  } catch (e) {
    console.log('[XRB-BG] query failed:', e.message);
  }
}

chrome.runtime.onInstalled.addListener(injectIntoExistingTabs);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message && message.type === 'PING') {
    sendResponse({ ok: true, version: '1.7.0' });
    return true;
  }
});
