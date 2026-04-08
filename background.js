
'use strict';


const injectedTabs = new Set();


async function injectIntoTab(tabId) {
  if (injectedTabs.has(tabId)) return;
  injectedTabs.add(tabId);
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['injector.js'],
      world: 'MAIN'
    });
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content.js'],
      world: 'ISOLATED'
    });

    await chrome.scripting.insertCSS({
      target: { tabId },
      files: ['content.css']
    });
    console.log('[XRB-BG] Injected into tab:', tabId);
  } catch (e) {
    injectedTabs.delete(tabId);
    console.log('[XRB-BG] Inject skipped for tab', tabId, ':', e.message);
  }
}


chrome.tabs.onRemoved.addListener(tabId => {
  injectedTabs.delete(tabId);
});

async function injectIntoExistingTabs() {
  try {
    const tabs = await chrome.tabs.query({
      url: ['https://x.com/*', 'https://twitter.com/*']
    });
    console.log('[XRB-BG] Found', tabs.length, 'existing X tabs');
    for (const tab of tabs) {
      if (tab.id) await injectIntoTab(tab.id);
    }
  } catch (e) {
    console.log('[XRB-BG] Error injecting into existing tabs:', e.message);
  }
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete') return;
  const url = tab.url || '';
  if (url.startsWith('https://x.com/') || url.startsWith('https://twitter.com/')) {
    console.log('[XRB-BG] X tab navigated, injecting:', tabId);
    injectIntoTab(tabId);
  }
});

injectIntoExistingTabs();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'PING') {
    sendResponse({ ok: true, version: '1.1.0' });
    return true;
  }
});

console.log('[XRB-BG] v1.0 Background started — programmatic injection active');
