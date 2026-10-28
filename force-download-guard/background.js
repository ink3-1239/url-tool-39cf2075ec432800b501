/* =============================================================================
 * background.js — バックグラウンド Service Worker
 *
 * 役割
 *   1. ダウンロードの許可判定（強制ダウンロードの遮断）
 *        - 実行ファイル / 追加拡張・アーカイブはユーザー操作があっても遮断
 *        - 保護対象ページで「操作の無い自動ダウンロード」が起きたら遮断
 *        - 偽警告ページと判定されたタブではすべて遮断
 *   2. declarativeNetRequest によるネットワーク層の遮断（多層防御）
 *   3. ブロック履歴の記録・通知
 * ========================================================================== */
'use strict';

importScripts('shared.js');

const FDG = globalThis.FDG;

/* ------------------------------------------------------------------ 設定 */
const DEFAULTS = FDG.DEFAULT_SETTINGS;

let settings = Object.assign({}, DEFAULTS);

/* --------------------------------------------------------------- 実行時状態 */
const gestures = new Map();  // tabId -> { ts, urls[], hosts[] }
const nagTabs = new Map();   // tabId -> { url, ts }
const blockedIds = new Set();// 遮断済み・記録済みの downloadId（二重記録防止）

/* このブラウザセッションだけ有効な「保護サイト」（保存ファイルに載せない一時設定） */
let sessionSites = [];

/** 永続設定 + セッション設定をマージした「有効な設定」 */
function effectiveSettings() {
  return Object.assign({}, settings, {
    protectedSites: (settings.protectedSites || []).concat(sessionSites),
  });
}

async function loadSessionSites() {
  try {
    const data = await chrome.storage.session.get(['sites']);
    sessionSites = (data.sites || []).filter((s) => typeof s === 'string');
  } catch (e) {
    sessionSites = [];
  }
}

/* DNR 動的ルール ID */
const RULE = { exec: 1, bundle: 2, trust: 3 };

/* ============================================================== 初期化 ==== */
async function init() {
  const data = await chrome.storage.local.get(['settings']);
  settings = Object.assign({}, DEFAULTS, data.settings || {});
  await loadSessionSites();
  await applyRules();
  await syncWideScripts();
  updateActionState();
}

chrome.runtime.onInstalled.addListener(async (details) => {
  await init();
  if (details.reason === 'install') {
    chrome.notifications.create('fdg-welcome', {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon128.png'),
      title: '強制ダウンロード ガード を導入しました',
      message: '拡張機能ページとストアでの自動・強制ダウンロードをブロックします。' +
        'ポップアップから設定を変更できます。',
    });
  }
});

chrome.runtime.onStartup.addListener(() => { init(); });

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'session') {
    // 一時保護サイトの増減
    if (changes.sites) {
      sessionSites = (changes.sites.newValue || []).filter((s) => typeof s === 'string');
      applyRules();
      syncWideScripts();
      updateActionState();
    }
    return;
  }
  if (area !== 'local' || !changes.settings) return;
  settings = Object.assign({}, DEFAULTS, changes.settings.newValue || {});
  applyRules();
  syncWideScripts();
  updateActionState();
});

chrome.tabs.onRemoved.addListener((tabId) => {
  gestures.delete(tabId);
  nagTabs.delete(tabId);
});

init();

/* ====================================================== ヘルパー関数 ====== */
function getTab(tabId) {
  if (tabId == null || tabId < 0) return Promise.resolve(null);
  return chrome.tabs.get(tabId).catch(() => null);
}

function publicSettings() {
  const cfg = effectiveSettings();
  return {
    enabled: cfg.enabled,
    scope: cfg.scope,
    blockExecutables: cfg.blockExecutables,
    blockBundles: cfg.blockBundles,
    blockAutoDownloads: cfg.blockAutoDownloads,
    detectNagPages: cfg.detectNagPages,
    showNotifications: cfg.showNotifications,
    gestureWindowMs: cfg.gestureWindowMs,
    trustedDomains: cfg.trustedDomains || [],
    protectedSites: cfg.protectedSites || [],
    sessionSites: sessionSites.slice(),
  };
}

/* ================================================== ネットワーク層の遮断 ==== */
/** ユーザー指定の保護サイトのホスト一覧（DNR の起点ドメインに使う） */
function siteHosts() {
  const out = [];
  const cfg = effectiveSettings();
  (cfg.protectedSites || []).forEach((s) => {
    const n = FDG.normalizeSiteInput(s);
    if (n && out.indexOf(n.base) === -1) out.push(n.base);
  });
  return out;
}

async function applyRules() {
  const rules = [];
  const cfg = effectiveSettings();
  const trusted = cfg.trustedDomains || [];
  const wide = cfg.scope === 'wide';
  // 広域モードでなければ「ストア＋拡張機能ページ＋ユーザー指定サイト」を起点にする
  const initiators = wide
    ? null
    : FDG.STORE_DOMAINS.concat(FDG.LOCAL_DOMAINS).concat(siteHosts());
  const resourceTypes = ['main_frame', 'sub_frame', 'object', 'xmlhttprequest', 'other', 'ping'];

  const execRegex = '.*\\.(' + FDG.EXEC_EXTS.join('|') + ')([?#].*)?$';
  // 追加拡張 (.crx/.xpi) のみネットワーク層で遮断する。
  // アーカイブ (.zip 等) は正規利用もあるため、ダウンロード判定側（②）に任せる。
  const bundleRegex = '.*\\.(' + FDG.EXT_BUNDLE_EXTS.join('|') + ')([?#].*)?$';

  if (settings.blockExecutables) {
    rules.push({
      id: RULE.exec,
      priority: 1,
      action: { type: 'block' },
      condition: Object.assign(
        { regexFilter: execRegex, resourceTypes: resourceTypes },
        initiators ? { initiatorDomains: initiators } : {}
      ),
    });
  }

  if (settings.blockBundles) {
    rules.push({
      id: RULE.bundle,
      priority: 1,
      action: { type: 'block' },
      condition: Object.assign(
        { regexFilter: bundleRegex, resourceTypes: resourceTypes },
        initiators ? { initiatorDomains: initiators } : {}
      ),
    });
  }

  try {
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [RULE.exec, RULE.bundle],
      addRules: rules,
    });
  } catch (e) {
    console.warn('[FDG] DNR 遮断ルールの更新に失敗:', e && e.message);
  }

  // 信頼済みドメインは「許可」ルール（優先度・高）で遮断ルールを上書きする
  try {
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [RULE.trust],
      addRules: trusted.length
        ? [{
          id: RULE.trust,
          priority: 100,
          action: { type: 'allowAllRequests' },
          condition: { initiatorDomains: trusted, resourceTypes: resourceTypes },
        }]
        : [],
    });
  } catch (e) {
    console.warn('[FDG] DNR 信頼ルール（allowAllRequests）の更新に失敗:', e && e.message);
  }
}

/**
 * 動的 content script の同期
 *   ・広域モード（全ページ）
 *   ・ユーザー指定の保護サイト（そこで強制DLを遮断するため操作検知が必要）
 */
async function syncWideScripts() {
  try {
    const hasAll = await chrome.permissions.contains({ origins: ['<all_urls>'] });
    const wanted = settings.scope === 'wide' && hasAll;
    const registered = await chrome.scripting.getRegisteredContentScripts();
    const ids = registered.map((s) => s.id);

    if (wanted) {
      const toAdd = [];
      if (ids.indexOf('fdg-wide-isolated') === -1) {
        toAdd.push({
          id: 'fdg-wide-isolated',
          matches: ['<all_urls>'],
          js: ['shared.js', 'guard-isolated.js'],
          run_at: 'document_start',
          allFrames: false,
        });
      }
      if (ids.indexOf('fdg-wide-main') === -1) {
        toAdd.push({
          id: 'fdg-wide-main',
          matches: ['<all_urls>'],
          js: ['guard-main.js'],
          run_at: 'document_start',
          world: 'MAIN',
          allFrames: false,
        });
      }
      if (toAdd.length) await chrome.scripting.registerContentScripts(toAdd);
    } else {
      const toRemove = ['fdg-wide-isolated', 'fdg-wide-main'].filter((id) => ids.indexOf(id) !== -1);
      if (toRemove.length) await chrome.scripting.unregisterContentScripts({ ids: toRemove });
    }

    await syncSiteScripts();
  } catch (e) {
    console.warn('[FDG] 動的 content script の同期に失敗:', e && e.message);
  }
}

/** ユーザー指定サイトの content script を登録する（操作検知のため） */
async function syncSiteScripts() {
  try {
    const patterns = [];
    const cfg = effectiveSettings();
    (cfg.protectedSites || []).forEach((s) => {
      const n = FDG.normalizeSiteInput(s);
      if (n && patterns.indexOf(n.pattern) === -1) patterns.push(n.pattern);
    });

    // アクセス許可のあるサイトだけ content script を登録する
    const granted = [];
    for (const p of patterns) {
      let ok = false;
      try { ok = await chrome.permissions.contains({ origins: [p] }); } catch (e) { ok = false; }
      if (ok) granted.push(p);
    }

    const registered = await chrome.scripting.getRegisteredContentScripts();
    const ids = registered.map((s) => s.id);

    if (!granted.length) {
      const toRemove = ['fdg-sites-isolated', 'fdg-sites-main']
        .filter((id) => ids.indexOf(id) !== -1);
      if (toRemove.length) await chrome.scripting.unregisterContentScripts({ ids: toRemove });
      return;
    }

    // パターンが変わったときは登録し直す
    const current = registered.find((s) => s.id === 'fdg-sites-isolated');
    const same = current && JSON.stringify(current.matches) === JSON.stringify(granted);
    if (same) return;

    const toRemove = ['fdg-sites-isolated', 'fdg-sites-main']
      .filter((id) => ids.indexOf(id) !== -1);
    if (toRemove.length) await chrome.scripting.unregisterContentScripts({ ids: toRemove });

    await chrome.scripting.registerContentScripts([
      {
        id: 'fdg-sites-isolated',
        matches: granted,
        js: ['shared.js', 'guard-isolated.js'],
        run_at: 'document_start',
        allFrames: false,
      },
      {
        id: 'fdg-sites-main',
        matches: granted,
        js: ['guard-main.js'],
        run_at: 'document_start',
        world: 'MAIN',
        allFrames: false,
      },
    ]);
  } catch (e) {
    console.warn('[FDG] 保護サイトの content script 同期に失敗:', e && e.message);
  }
}

/* ================================================= ダウンロード判定 ======== */
async function judgeDownload(item) {
  const url = item.url || '';
  const name = item.filename || '';
  const tabId = item.tabId;

  const tab = await getTab(tabId);
  const originUrl = (tab && tab.url) || item.referrer || '';
  let scope = FDG.scopeFor(originUrl, effectiveSettings());

  // 自拡張機能のテスト用リソースは、どこから 要求されても保護対象にする
  // （ポップアップ内やテストページからの再現用）
  if (!scope.inScope && url.indexOf('chrome-extension://' + FDG.EXTENSION_ID + '/') === 0) {
    scope = { inScope: true, host: scope.host, reason: 'extension-page' };
  }

  const base = {
    file: name || (url.split('/').pop() || url),
    url: url,
    tabId: tabId,
    originUrl: originUrl,
    host: scope.host,
    scopeReason: scope.reason,
  };

  // 1) 実行ファイル / 追加拡張 (.crx/.xpi) は「ユーザー操作があっても」遮断
  const isExec = FDG.isExecutable(name) || FDG.isExecutable(url);
  const isExtBundle = FDG.isExtensionBundle(name) || FDG.isExtensionBundle(url);
  const isArchive = FDG.isArchive(name) || FDG.isArchive(url);
  if (scope.inScope) {
    if (settings.blockExecutables && isExec) {
      return Object.assign({ block: true, reason: 'executable' }, base);
    }
    if (settings.blockBundles && isExtBundle) {
      return Object.assign({ block: true, reason: 'bundle' }, base);
    }
  }

  // 2) 保護対象外なら触らない
  if (!scope.inScope) {
    return Object.assign({ block: false, reason: 'out-of-scope' }, base);
  }

  if (!settings.blockAutoDownloads) {
    return Object.assign({ block: false, reason: 'auto-check-off' }, base);
  }

  // 3) 偽警告ページと判定されたタブは全面遮断
  if (nagTabs.has(tabId)) {
    return Object.assign({ block: true, reason: 'nag-page' }, base);
  }

  // 4) 直近の「本物のユーザー操作」が無ければ強制ダウンロード扱い
  const g = gestures.get(tabId);
  const recent = !!(g && Date.now() - g.ts <= settings.gestureWindowMs);
  if (!recent) {
    // アーカイブは「強制取得」でなければ通す（正規の Zip 取得を壊さないため）
    const reason = (settings.blockBundles && isArchive) ? 'archive' : 'no-gesture';
    return Object.assign({ block: true, reason: reason }, base);
  }

  // 5) ユーザー指定の保護サイト: すべての強制ダウンロードをブロック
  //    （アーカイブもユーザー操作があっても遮断する）
  if (scope.reason === 'user-site' && settings.blockBundles && isArchive) {
    return Object.assign({ block: true, reason: 'archive' }, base);
  }

  return Object.assign({ block: false, reason: 'user-gesture' }, base);
}

function labelOf(reason) {
  return FDG.REASON_LABELS[reason] || reason;
}

async function record(entry) {
  entry.t = Date.now();
  try {
    const data = await chrome.storage.local.get(['log']);
    const log = data.log || [];
    log.unshift(entry);
    await chrome.storage.local.set({ log: log.slice(0, 60) });
  } catch (e) { /* 記録に失敗しても処理は続行 */ }
  flashBadge();
}

/* ============================================ ツールバーアイコンの状態 ==== */
/** バッジに現在のタブの状態を出す（保護中 / OFF など） */
let badgeText = '';
let badgeColor = '#15803d';
let flashTimer = null;

function applyBadge() {
  chrome.action.setBadgeText({ text: badgeText }).catch(() => {});
  chrome.action.setBadgeBackgroundColor({ color: badgeColor }).catch(() => {});
}

/** ブロック発生時に一瞬「!」を表示してから状態に戻す */
function flashBadge() {
  badgeText = '!';
  badgeColor = '#c62828';
  applyBadge();
  if (flashTimer) clearTimeout(flashTimer);
  flashTimer = setTimeout(() => { updateActionState(); }, 8000);
}

/** 現在のタブの状態をアイコン（バッジ＋ツールチップ）に反映する */
async function updateActionState() {
  const cfg = effectiveSettings();
  let tab = null;
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    tab = (tabs && tabs[0]) || null;
  } catch (e) { tab = null; }

  const url = (tab && tab.url) || '';
  const scope = FDG.scopeFor(url, cfg);

  let title;
  if (!cfg.enabled) {
    badgeText = 'OFF';
    badgeColor = '#6b7280';
    title = '強制ダウンロード ガード（無効）';
  } else if (scope.inScope) {
    badgeText = '保護';
    badgeColor = '#15803d';
    title = '強制ダウンロード ガード — このサイトは保護中です（クリックで設定）';
  } else {
    badgeText = '';
    badgeColor = '#15803d';
    title = '強制ダウンロード ガード — このサイトで強制ダウンロードを止める（クリックで設定）';
  }
  applyBadge();
  try { chrome.action.setTitle({ title: title }); } catch (e) { /* noop */ }
}

let stateTimer = null;
function scheduleActionState() {
  if (stateTimer) clearTimeout(stateTimer);
  stateTimer = setTimeout(() => { updateActionState(); }, 150);
}

chrome.tabs.onActivated.addListener(() => { scheduleActionState(); });
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'complete' || changeInfo.url) scheduleActionState();
});


async function notifyTab(tabId, payload) {
  // 拡張機能のページ（ポップアップ・テストページ）にも通知する
  try {
    chrome.runtime.sendMessage(Object.assign({ type: 'fdg:blocked-event' }, payload)).catch(() => {});
  } catch (e) { /* noop */ }
  if (tabId == null || tabId < 0) return;
  try {
    await chrome.tabs.sendMessage(tabId, Object.assign({ type: 'fdg:blocked' }, payload));
  } catch (e) { /* content script が無いページでは無視 */ }
}

/* ============================================== ダウンロード イベント ===== */
/**
 * 遮断判定をまとめて実行し、記録・通知・中断まで行う。
 * @param {object} item  chrome.downloads .DownloadItem 相当
 * @param {string} finalName  最終ファイル名（判定時のみ）
 */
function runJudge(item, finalName) {
  const probe = {
    id: item.id,
    url: item.url,
    filename: finalName || item.filename || '',
    tabId: item.tabId,
    referrer: item.referrer,
  };
  return judgeDownload(probe).then((v) => {
    if (!v.block) return v;
    if (blockedIds.has(item.id)) return v;
    blockedIds.add(item.id);
    if (blockedIds.size > 200) blockedIds.clear();

    chrome.downloads.cancel(item.id, { erase: true }).catch(() => {});
    const entry = {
      action: 'blocked',
      reason: v.reason,
      file: v.file,
      url: v.url,
      host: v.host,
      tabUrl: v.originUrl,
    };
    record(entry);
    notifyTab(v.tabId, entry);
    if (settings.showNotifications) {
      chrome.notifications.create('fdg-' + item.id + '-' + Date.now(), {
        type: 'basic',
        iconUrl: chrome.runtime.getURL('icons/icon128.png'),
        title: '強制ダウンロードをブロックしました',
        message: (v.file || v.url) + ' ／ ' + labelOf(v.reason),
      });
    }
    return v;
  });
}

chrome.downloads.onCreated.addListener((item) => {
  if (!settings.enabled) return;
  runJudge(item);
});

/**
 * 最終ファイル名での判定。
 * URL に拡張子がなくても Content-Disposition 等で .exe が渡されることがあるため。
 */
chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
  // すでに遮断済みなら何もしない
  if (blockedIds.has(item.id)) {
    try { suggest({}); } catch (e) { /* noop */ }
    return;
  }
  const name = (item && item.filename) || (suggest && suggest.filename) || '';
  if (!name || (!FDG.isExecutable(name) && !FDG.isBundle(name))) return;
  if (!settings.enabled) return;
  runJudge(item, name).then(() => {
    // コールバックを解放する（cancel 済みなら保存は止まる）
    try { suggest({}); } catch (e) { /* noop */ }
  });
});

/* DNR により遮断されたダウンロード（BLOCKED_BY_CLIENT）の後始末 */
chrome.downloads.onChanged.addListener((delta) => {
  if (!delta || !delta.state) return;
  if (delta.state.current !== 'interrupted') return;
  if (delta.error && delta.error.current && delta.error.current !== 'BLOCKED_BY_CLIENT') return;
  if (blockedIds.has(delta.id)) return;
  blockedIds.add(delta.id);
  chrome.downloads.erase({ id: delta.id }).catch(() => {});
});

/* ==================================================== メッセージ処理 ====== */
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (!msg || !msg.type) return sendResponse({ ok: false });
    const tabId = sender.tab ? sender.tab.id : null;

    switch (msg.type) {
      case 'fdg:init': {
        const url = (sender.tab && sender.tab.url) || msg.url || '';
        const scope = FDG.scopeFor(url, effectiveSettings());
        sendResponse({
          ok: true,
          inScope: scope.inScope,
          reason: scope.reason,
          settings: publicSettings(),
        });
        break;
      }

      case 'fdg:gesture': {
        if (tabId != null) {
          gestures.set(tabId, {
            ts: msg.ts || Date.now(),
            urls: msg.urls || [],
            hosts: msg.hosts || [],
          });
        }
        sendResponse({ ok: true });
        break;
      }

      case 'fdg:nag': {
        if (tabId != null) nagTabs.set(tabId, { url: msg.url || '', ts: Date.now() });
        try {
          chrome.runtime.sendMessage({
            type: 'fdg:nag-event', url: msg.url || '',
            hits: msg.hits || 0, dangerLinks: msg.dangerLinks || 0,
          }).catch(() => {});
        } catch (e) { /* noop */ }
        sendResponse({ ok: true });
        break;
      }

      case 'fdg:allow-domain': {
        const host = (msg.host || '').toLowerCase();
        if (host) {
          const list = (settings.trustedDomains || []).slice();
          if (list.indexOf(host) === -1) list.push(host);
          settings.trustedDomains = list;
          await chrome.storage.local.set({ settings: settings });
        }
        sendResponse({ ok: true });
        break;
      }

      case 'fdg:log': {
        const data = await chrome.storage.local.get(['log']);
        sendResponse({ ok: true, log: data.log || [] });
        break;
      }

      /* 登録直後に、開いているタブへガードを注入する（再読み込みなしで守りを効かせる） */
      case 'fdg:protect-now': {
        const host = msg.host || '';
        const count = await injectIntoTabs(host);
        sendResponse({ ok: true, count: count });
        break;
      }

      /* そのサイトで強制DLを止める（有効化） */
      case 'fdg:activate': {
        const host = msg.host || '';
        const res = await activateSite(host, !!msg.persistent);
        sendResponse(Object.assign({ ok: true }, res));
        break;
      }

      case 'fdg:clear-log': {
        await chrome.storage.local.set({ log: [] });
        sendResponse({ ok: true });
        break;
      }

      default:
        sendResponse({ ok: false });
    }
  })();
  return true; // 応答を非同期で返す
});

/* ============================================== 補助: 保護サイトの有効化 ==== */
/** 該当ホストの開いているタブへガードを注入する（再読み込み不要） */
async function injectIntoTabs(host) {
  let count = 0;
  try {
    const tabs = await chrome.tabs.query({});
    for (const t of tabs) {
      if (!t || t.id == null || !t.url) continue;
      const h = FDG.hostOf(t.url);
      if (!h || !FDG.siteMatches(h, host)) continue;
      try {
        await chrome.scripting.executeScript({
          target: { tabId: t.id, allFrames: false },
          files: ['shared.js', 'guard-isolated.js'],
        });
        await chrome.scripting.executeScript({
          target: { tabId: t.id, allFrames: false },
          files: ['guard-main.js'],
          world: 'MAIN',
        });
        count++;
      } catch (e) { /* 注入できないページ（chrome:// 等）は無視 */ }
    }
  } catch (e) { /* noop */ }
  return count;
}

/**
 * サイトを保護対象として有効化する。
 * @param {string} host  ホスト名
 * @param {boolean} persistent  true = 永続（保存ルール）／false = このセッションのみ
 */
async function activateSite(host, persistent) {
  if (!host) return { count: 0 };
  if (persistent) {
    const list = (settings.protectedSites || []).slice();
    if (list.indexOf(host) === -1) {
      list.push(host);
      settings.protectedSites = list;
      await chrome.storage.local.set({ settings: settings });
    }
  } else {
    const list = sessionSites.slice();
    if (list.indexOf(host) === -1) {
      list.push(host);
      sessionSites = list;
      await chrome.storage.session.set({ sites: list });
    }
  }
  await applyRules();
  await syncWideScripts();
  updateActionState();
  const count = await injectIntoTabs(host);
  return { count: count };
}

/* ============================================== 補助: 通知クリック ====== */
chrome.notifications.onClicked.addListener((id) => {
  chrome.notifications.clear(id).catch(() => {});
});

/* ============================================== 補助: アドレスバー ====== */
/**
 * アドレスバーに「guard」「ガード」「fdg」と入れて Enter で
 * そのタブのサイトの強制ダウンロードを止める。
 */
if (chrome.omnibox) {
  chrome.omnibox.onInputEntered.addListener(async (text) => {
    const key = String(text || '').trim().toLowerCase();
    if (key !== 'guard' && key !== 'ガード' && key !== 'fdg') return;

    let tab = null;
    try {
      const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      tab = tabs && tabs[0];
    } catch (e) { tab = null; }
    if (!tab || !tab.url) return;

    const n = FDG.normalizeSiteInput(tab.url);
    if (!n) return;

    let granted = false;
    try { granted = await chrome.permissions.contains({ origins: [n.pattern] }); } catch (e) { granted = false; }
    if (!granted) {
      // 許可が要るときは、許可ボタンを用意したページを開く
      await chrome.tabs.create({
        url: chrome.runtime.getURL('activate.html') + '?url=' + encodeURIComponent(tab.url),
      });
      return;
    }

    await activateSite(n.host, false);
    chrome.notifications.create('fdg-activate-' + Date.now(), {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon128.png'),
      title: 'このサイトで強制ダウンロードを止めました',
      message: n.host + ' ／ このセッション中、強制ダウンロードをブロックします。',
    });
  });
}
