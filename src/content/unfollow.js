// ───────────── Unfollow non-followers ─────────────
// Started from the popup; takes you to YOUR Following page first, then runs there.
// Language-independent: uses X's data-testids first; localized texts are only a fallback.
const UNF_TEXTS = {
    followsYou: ['Follows you', 'Te sigue', 'Segue você', 'Mengikuti Kamu', 'Seni takip ediyor', 'Vous suit', 'Folgt dir', 'يتابعك'],
    following: ['Following', 'Siguiendo', 'Seguindo', 'Mengikuti', 'Takip ediliyor', 'Abonné', 'Abonnement', 'Folge ich', 'Gefolgt', 'متابَع'],
    unfollow: ['Unfollow', 'Dejar de seguir', 'Deixar de Seguir', 'Tidak Mengikuti', 'Takibi bırak', 'Ne plus suivre', 'Entfolgen', 'إلغاء المتابعة']
};
const PENDING_KEY = 'xrb_pending_unfollow';
// safe ≈ 15/min · fast ≈ 100/min · turbo = as fast as X's UI responds
const UNF_SPEEDS = {
    safe:  { pre: 250, poll: 150, post: 400, gap: [1800, 3800], scroll: 1200 },
    fast:  { pre: 30,  poll: 50,  post: 120, gap: [250, 450],   scroll: 500 },
    turbo: { pre: 0,   poll: 30,  post: 50,  gap: [0, 40],      scroll: 350 }
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
    if (!unf.panel || !unf.panel.isConnected) {
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

async function unfollowCell(cell, sp) {
    cell.scrollIntoView({ block: 'center' });
    if (sp.pre) await sleep(sp.pre);
    const btn = cell.querySelector('[data-testid$="-unfollow"]')
        || [...cell.querySelectorAll('[role="button"]')].find(b => UNF_TEXTS.following.includes(b.textContent.trim()));
    if (!btn) return false;
    btn.click();
    for (let i = 0; i < Math.ceil(3000 / sp.poll); i++) {           // wait up to ~3s for the confirm dialog
        await sleep(sp.poll);
        const confirmBtn = document.querySelector('[data-testid="confirmationSheetConfirm"]')
            || [...document.querySelectorAll('[role="button"]')].find(b => UNF_TEXTS.unfollow.includes(b.textContent.trim()));
        if (confirmBtn) { confirmBtn.click(); await sleep(sp.post); return true; }
    }
    return false;
}

async function runUnfollow(max, skip, sp) {
    const processed = new Set();
    let idle = 0, failures = 0, reason = 'Finished';
    window.scrollTo(0, 0);
    await sleep(sp === UNF_SPEEDS.safe ? 800 : 250);
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
                if (await unfollowCell(cell, sp)) {
                    unf.done++;
                    failures = 0;
                    unfPanel(`Unfollowed ${unf.done}${max < Infinity ? ' / ' + max : ''}…`);
                    await sleep(unfRand(sp.gap[0], sp.gap[1]));
                } else if (++failures >= 3) {
                    unf.stop = true;
                    reason = 'Stopped: unfollow button/confirm not found 3×';
                }
            }
            if (unf.stop) break;
            window.scrollBy(0, Math.round(window.innerHeight * 0.8));
            await sleep(sp.scroll);
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

function onOwnFollowingPage() {
    detectOwnUsername();
    const m = window.location.pathname.match(/^\/([A-Za-z0-9_]+)\/following\/?$/);
    return !!m && !!ownUsername && m[1].toLowerCase() === ownUsername;
}

// Start from anywhere: if we're not on YOUR Following page, remember the job, go there, and resume after load
async function requestUnfollow(opts) {
    if (unf.running) return { ok: false, error: 'Already running' };
    if (onOwnFollowingPage()) return startUnfollow(opts);
    try { await chrome.storage.local.set({ [PENDING_KEY]: { max: opts.max, skip: opts.skip || [], speed: opts.speed, ts: Date.now(), hops: 0 } }); } catch (e) { }
    unfPanel('Opening your Following page…', { finished: true });
    resumePendingUnfollow();
    return { ok: true, navigating: true };
}

async function resumePendingUnfollow() {
    let job;
    try { job = (await chrome.storage.local.get(PENDING_KEY))[PENDING_KEY]; } catch (e) { return; }
    if (!job) return;
    const clear = () => { try { chrome.storage.local.remove(PENDING_KEY); } catch (e) { } };
    if (Date.now() - job.ts > 3 * 60 * 1000 || (job.hops || 0) > 2) { clear(); return; }

    for (let i = 0; i < 40 && !ownUsername; i++) { detectOwnUsername(); if (!ownUsername) await sleep(250); }
    if (!ownUsername) { clear(); unfPanel('Could not find your username — open your profile once, then retry.', { finished: true }); return; }

    if (!onOwnFollowingPage()) {
        job.hops = (job.hops || 0) + 1;
        try { await chrome.storage.local.set({ [PENDING_KEY]: job }); } catch (e) { }
        window.location.assign(`/${ownUsername}/following`);
        return;
    }
    for (let i = 0; i < 40 && !document.querySelector('[data-testid="UserCell"]'); i++) await sleep(250);
    clear();
    if (unf.panel) { unf.panel.remove(); unf.panel = null; }
    startUnfollow(job);
}

function startUnfollow(opts) {
    if (unf.running) return { ok: false, error: 'Already running' };
    if (!onOwnFollowingPage()) return { ok: false, error: 'Open YOUR Following page' };
    unf.running = true;
    unf.stop = false;
    unf.done = 0;
    const max = opts.max > 0 ? opts.max : Infinity;
    const skip = new Set((opts.skip || []).map(s => String(s).toLowerCase().replace(/^@/, '').trim()).filter(Boolean));
    unfPanel('Starting…');
    runUnfollow(max, skip, UNF_SPEEDS[opts.speed] || UNF_SPEEDS.fast);
    return { ok: true };
}

function initUnfollowListener() {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
        if (!alive() || !msg || !msg.type) return;
        if (msg.type === 'XRB_UNFOLLOW_START') { requestUnfollow(msg).then(sendResponse); return true; }
        if (msg.type === 'XRB_UNFOLLOW_STOP') { unf.stop = true; sendResponse({ ok: true }); return; }
        if (msg.type === 'XRB_UNFOLLOW_STATUS') { sendResponse({ running: unf.running, done: unf.done }); return; }
    });
}
