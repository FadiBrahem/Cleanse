let blockedRegions = [];
let blockMode = 'overlay';
let blockAffiliate = false;
let blockAffiliated = false;
let whitelistMode = 'mutuals';
let showLabels = true;
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
const whitelistSelect = $('whitelistSelect');
const themeColorInput = $('themeColorInput');
const labelColorInput = $('labelColorInput');

function saveAndSync() {
  chrome.storage.sync.set({ blockedRegions, blockMode, blockAffiliate, blockAffiliated, whitelistMode, showLabels, themeColor, labelColor });
  render();
}

function loadSettings() {
  chrome.storage.sync.get(
    ['blockedRegions', 'blockMode', 'blockAffiliate', 'blockAffiliated', 'whitelistMode', 'showLabels', 'themeColor', 'labelColor'],
    (data) => {
      blockedRegions = data.blockedRegions || [];
      blockMode = data.blockMode || 'overlay';
      blockAffiliate = !!data.blockAffiliate;
      blockAffiliated = !!data.blockAffiliated;
      whitelistMode = data.whitelistMode || 'mutuals';
      showLabels = data.showLabels !== false;
      themeColor = data.themeColor || '#ff2222';
      labelColor = data.labelColor || '#22c55e';
      labelColorInput.value = labelColor;
      blockAffiliateCheck.checked = blockAffiliate;
      blockAffiliatedCheck.checked = blockAffiliated;
      showLabelsCheck.checked = showLabels;
      whitelistSelect.value = whitelistMode;
      themeColorInput.value = themeColor;
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
  toastTimer = setTimeout(() => toast.classList.remove('show'), 1800);
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

blockAffiliateCheck.addEventListener('change', e => {
  blockAffiliate = e.target.checked; saveAndSync();
  showToast(blockAffiliate ? 'Affiliate blocking on' : 'Affiliate blocking off');
});
blockAffiliatedCheck.addEventListener('change', e => {
  blockAffiliated = e.target.checked; saveAndSync();
  showToast(blockAffiliated ? 'Affiliated-badge blocking on' : 'Affiliated-badge blocking off');
});
showLabelsCheck.addEventListener('change', e => {
  showLabels = e.target.checked; saveAndSync();
  showToast(showLabels ? 'Region labels on' : 'Region labels off');
});
whitelistSelect.addEventListener('change', e => { whitelistMode = e.target.value; saveAndSync(); });
labelColorInput.addEventListener('input', e => { labelColor = e.target.value; saveAndSync(); });
themeColorInput.addEventListener('input', e => { themeColor = e.target.value; saveAndSync(); });

loadSettings();
