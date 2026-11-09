let blockedRegions = [];
let blockMode = 'overlay';
let blockAffiliate = false;
let blockAffiliated = false;
let whitelistMode = 'mutuals';
let showLabels = true;
let followersMode = 'nofollowback';
let showRelation = true;
let relOnlyFollowing = true;
let themeColor = '#ff2222';
let labelColor = '#22c55e';

const $ = id => document.getElementById(id);
const regionInput = $('regionInput');
const addBtn = $('addBtn');
const tagsList = $('tagsList');
const tagsEmpty = $('tagsEmpty');
const blockedCount = $('blockedCount');
const clearBtn = $('clearBtn');
const statusDot = $('statusDot');
const toast = $('toast');
const blockAffiliateCheck = $('blockAffiliateCheck');
const blockAffiliatedCheck = $('blockAffiliatedCheck');
const showLabelsCheck = $('showLabelsCheck');
const followersSelect = $('followersSelect');
const showRelationCheck = $('showRelationCheck');
const relOnlyFollowingCheck = $('relOnlyFollowingCheck');
const whitelistSelect = $('whitelistSelect');
const themeColorInput = $('themeColorInput');
const labelColorInput = $('labelColorInput');
const unfollowMax = $('unfollowMax');
const unfollowSkip = $('unfollowSkip');
const unfollowSpeed = $('unfollowSpeed');

const SETTING_KEYS = ['blockedRegions', 'blockMode', 'blockAffiliate', 'blockAffiliated', 'whitelistMode',
  'showLabels', 'followersMode', 'showFollowers', 'showRelation', 'relOnlyFollowing', 'themeColor', 'labelColor',
  'unfollowMax', 'unfollowSkip', 'unfollowSpeed'];

function saveAndSync() {
  chrome.storage.sync.set({
    blockedRegions, blockMode, blockAffiliate, blockAffiliated, whitelistMode,
    showLabels, followersMode, showRelation, relOnlyFollowing, themeColor, labelColor
  });
  render();
}

function loadSettings() {
  chrome.storage.sync.get(SETTING_KEYS, (data) => {
    blockedRegions = data.blockedRegions || [];
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

    blockAffiliateCheck.checked = blockAffiliate;
    blockAffiliatedCheck.checked = blockAffiliated;
    showLabelsCheck.checked = showLabels;
    followersSelect.value = followersMode;
    showRelationCheck.checked = showRelation;
    relOnlyFollowingCheck.checked = relOnlyFollowing;
    whitelistSelect.value = whitelistMode;
    themeColorInput.value = themeColor;
    labelColorInput.value = labelColor;
    unfollowMax.value = data.unfollowMax != null ? data.unfollowMax : 100;
    unfollowSpeed.value = data.unfollowSpeed || 'fast';
    unfollowSkip.value = data.unfollowSkip || '';
    render();
  });
}

function render() {
  document.querySelectorAll('.mode-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.mode === blockMode));

  tagsList.innerHTML = '';
  if (blockedRegions.length === 0) {
    tagsEmpty.style.display = 'block';
    tagsList.style.display = 'none';
  } else {
    tagsEmpty.style.display = 'none';
    tagsList.style.display = 'flex';
    blockedRegions.forEach((region, idx) => {
      const tag = document.createElement('div');
      tag.className = 'tag';
      tag.innerHTML = `<span>${escapeHtml(region)}</span><button class="tag-remove" data-idx="${idx}" title="Remove">×</button>`;
      tagsList.appendChild(tag);
    });
  }
  blockedCount.textContent = blockedRegions.length;
  statusDot.classList.toggle('inactive', blockedRegions.length === 0 && !blockAffiliate && !blockAffiliated);
}

function addRegion(value) {
  const trimmed = value.trim();
  if (!trimmed) return;
  if (blockedRegions.map(r => r.toLowerCase()).includes(trimmed.toLowerCase())) {
    showToast(`"${trimmed}" already added`);
    return;
  }
  blockedRegions.push(trimmed);
  saveAndSync();
  showToast(`Added: ${trimmed}`);
}

function removeRegion(idx) {
  const removed = blockedRegions[idx];
  blockedRegions.splice(idx, 1);
  saveAndSync();
  showToast(`Removed: ${removed}`);
}

function escapeHtml(str) {
  return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

let toastTimer;
function showToast(msg) {
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2200);
}

addBtn.addEventListener('click', () => { addRegion(regionInput.value); regionInput.value = ''; regionInput.focus(); });
regionInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { addRegion(regionInput.value); regionInput.value = ''; } });
tagsList.addEventListener('click', (e) => {
  const btn = e.target.closest('.tag-remove');
  if (btn) removeRegion(parseInt(btn.dataset.idx, 10));
});
document.querySelectorAll('.mode-btn').forEach(btn => btn.addEventListener('click', () => { blockMode = btn.dataset.mode; saveAndSync(); }));
document.querySelectorAll('.preset-btn').forEach(btn => btn.addEventListener('click', () => addRegion(btn.dataset.region)));
clearBtn.addEventListener('click', () => {
  if (blockedRegions.length === 0) return;
  blockedRegions = [];
  saveAndSync();
  showToast('Cleared all regions');
});

blockAffiliateCheck.addEventListener('change', e => { blockAffiliate = e.target.checked; saveAndSync(); });
blockAffiliatedCheck.addEventListener('change', e => { blockAffiliated = e.target.checked; saveAndSync(); });
showLabelsCheck.addEventListener('change', e => { showLabels = e.target.checked; saveAndSync(); });
followersSelect.addEventListener('change', e => { followersMode = e.target.value; saveAndSync(); });
showRelationCheck.addEventListener('change', e => { showRelation = e.target.checked; saveAndSync(); });
relOnlyFollowingCheck.addEventListener('change', e => { relOnlyFollowing = e.target.checked; saveAndSync(); });
whitelistSelect.addEventListener('change', e => { whitelistMode = e.target.value; saveAndSync(); });
themeColorInput.addEventListener('input', e => { themeColor = e.target.value; saveAndSync(); });
labelColorInput.addEventListener('input', e => { labelColor = e.target.value; saveAndSync(); });

// ── Unfollow non-followers ──
unfollowMax.addEventListener('change', () => chrome.storage.sync.set({ unfollowMax: parseInt(unfollowMax.value, 10) || 0 }));
unfollowSpeed.addEventListener('change', () => chrome.storage.sync.set({ unfollowSpeed: unfollowSpeed.value }));
unfollowSkip.addEventListener('change', () => chrome.storage.sync.set({ unfollowSkip: unfollowSkip.value }));

async function activeTab() {
  const [t] = await chrome.tabs.query({ active: true, currentWindow: true });
  return t;
}

$('unfollowStart').addEventListener('click', async () => {
  const t = await activeTab();
  if (!t) return;
  const max = parseInt(unfollowMax.value, 10) || 0;
  const skip = unfollowSkip.value.split(/[,\s]+/).filter(Boolean);
  const speed = unfollowSpeed.value;
  if (!confirm(`Unfollow up to ${max || 'ALL'} accounts that don't follow you back?\n\nSpeed: ${speed}. You can stop it any time.\n\nFaster speeds can trigger X's action limits.`)) return;
  chrome.tabs.sendMessage(t.id, { type: 'XRB_UNFOLLOW_START', max, skip, speed }, res => {
    if (chrome.runtime.lastError || !res) {
      // Not on X (or the tab has no live script): save the job and open X — it resumes automatically after load
      chrome.storage.local.set({ xrb_pending_unfollow: { max, skip, speed, ts: Date.now(), hops: 0 } }, () => {
        chrome.tabs.update(t.id, { url: 'https://x.com/home' });
        showToast('Opening X…');
      });
    } else {
      showToast(res.ok ? 'Opening Following — see panel' : res.error);
    }
  });
});

$('unfollowStop').addEventListener('click', async () => {
  const t = await activeTab();
  if (t) chrome.tabs.sendMessage(t.id, { type: 'XRB_UNFOLLOW_STOP' }, () => { void chrome.runtime.lastError; });
  showToast('Stopping…');
});

loadSettings();
