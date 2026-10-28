#!/usr/bin/env node
/**
 * selftest.js — background.js の判定ロジックを chrome API スタブ上で検証する
 *   node tools/selftest.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

/* ------------------------------------------------------- chrome スタブ -- */
function evt() {
  const listeners = [];
  return {
    addListener: (fn) => listeners.push(fn),
    removeListener: (fn) => {
      const i = listeners.indexOf(fn);
      if (i !== -1) listeners.splice(i, 1);
    },
    hasListener: (fn) => listeners.indexOf(fn) !== -1,
    _fire: async (...args) => { for (const fn of listeners) await fn(...args); },
    _listeners: listeners,
  };
}

const store = { settings: null, log: [] };
const sessionStore = { sites: [] };
const state = {
  cancelled: [],
  erased: [],
  notifications: [],
  badRules: [],
  rules: [],
  tabs: {
    1: { id: 1, url: 'https://chromewebstore.google.com/detail/abc' },
    2: { id: 2, url: 'https://example.com/normal-page' },
    3: { id: 3, url: 'chrome://extensions/' },
    4: { id: 4, url: 'chrome-extension://abcdefghijklmnop/evil.html' },
  },
};

const chrome = {
  runtime: {
    onInstalled: evt(),
    onStartup: evt(),
    onMessage: evt(),
    getManifest: () => ({ version: '1.0.0' }),
    getURL: (p) => 'chrome-extension://testid/' + p,
    lastError: null,
  },
  storage: {
    local: {
      get: async (keys) => {
        const out = {};
        (Array.isArray(keys) ? keys : [keys]).forEach((k) => {
          if (k in store) out[k] = store[k];
        });
        return out;
      },
      set: async (obj) => {
        const changes = {};
        Object.keys(obj).forEach((k) => {
          changes[k] = { oldValue: store[k], newValue: obj[k] };
          store[k] = obj[k];
        });
        await chrome.storage.onChanged._fire(changes, 'local');
      },
    },
    onChanged: evt(),
    session: {
      get: async (keys) => {
        const out = {};
        (Array.isArray(keys) ? keys : [keys]).forEach((k) => {
          if (k in sessionStore) out[k] = sessionStore[k];
        });
        return out;
      },
      set: async (obj) => {
        const changes = {};
        Object.keys(obj).forEach((k) => {
          changes[k] = { oldValue: sessionStore[k], newValue: obj[k] };
          sessionStore[k] = obj[k];
        });
        await chrome.storage.onChanged._fire(changes, 'session');
      },
    },
  },
  tabs: {
    onRemoved: evt(),
    onActivated: evt(),
    onUpdated: evt(),
    get: async (id) => (state.tabs[id] ? state.tabs[id] : Promise.reject(new Error('no tab'))),
    query: async () => Object.values(state.tabs),
  },
  downloads: {
    onCreated: evt(),
    onDeterminingFilename: evt(),
    onChanged: evt(),
    cancel: async (id) => { state.cancelled.push(id); },
    erase: async (id) => { state.erased.push(id); },
  },
  declarativeNetRequest: {
    updateDynamicRules: async (arg) => {
      if (arg.addRules && arg.addRules.length) {
        arg.addRules.forEach((r) => {
          if (r.action.type === 'allowAllRequests') state.badRules.push(r);
        });
        state.rules = state.rules.concat(arg.addRules);
      }
    },
  },
  scripting: {
    getRegisteredContentScripts: async () => [],
    registerContentScripts: async () => {},
    unregisterContentScripts: async () => {},
  },
  permissions: {
    contains: async () => true,
    request: async () => true,
  },
  notifications: {
    create: async (id, opts) => { state.notifications.push(opts); },
    clear: async () => {},
    onClicked: evt(),
  },
  action: {
    setBadgeText: async () => {},
    setBadgeBackgroundColor: async () => {},
    setTitle: async () => {},
  },
};

/* --------------------------------------------------------- 実行環境 ---- */
const ctx = vm.createContext({
  chrome,
  console,
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
  URL,
  Date,
  Promise,
  importScripts: (p) => {
    const file = path.join(ROOT, p);
    vm.runInContext(fs.readFileSync(file, 'utf8'), ctx, { filename: file });
  },
});
vm.runInContext(fs.readFileSync(path.join(ROOT, 'shared.js'), 'utf8'), ctx, { filename: 'shared.js' });
vm.runInContext(fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8'), ctx, { filename: 'background.js' });

/* --------------------------------------------------------- テスト ------- */
const results = [];
function check(name, cond, extra) {
  results.push({ name, ok: !!cond, extra: extra || '' });
}

const dl = chrome.downloads.onCreated;
const msg = chrome.runtime.onMessage;

async function newDownload(id, url, tabId, filename) {
  await dl._fire({ id, url, tabId, filename: filename || '', referrer: '', mime: '' });
  await new Promise((r) => setTimeout(r, 20)); // 判定の Promise を待つ
}

async function send(message, tab) {
  let response = null;
  const listener = msg._listeners[0];
  await listener(message, { tab: tab }, (r) => { response = r; });
  return response;
}

(async function main() {
  await new Promise((r) => setTimeout(r, 50));

  // 設定更新ヘルパー（storage.onChanged を発火して background へ反映させる）
  const current = {
    enabled: true,
    scope: 'stores',
    blockExecutables: true,
    blockBundles: true,
    blockAutoDownloads: true,
    detectNagPages: true,
    showNotifications: true,
    gestureWindowMs: 2000,
    trustedDomains: [],
    protectedSites: [],
  };
  const setSettings = async (patch) => {
    Object.assign(current, patch);
    await chrome.storage.local.set({ settings: Object.assign({}, current) });
    await new Promise((r) => setTimeout(r, 10));
  };

  /* 1. ストアでユーザー操作なしの自動ダウンロード → 遮断 */
  await newDownload(101, 'https://chromewebstore.google.com/dl/setup.exe', 1);
  check('操作なしの自動ダウンロードを遮断', state.cancelled.includes(101), 'cancelled=' + JSON.stringify(state.cancelled));

  /* 2. 実行ファイルはユーザー操作があっても遮断 */
  await send({ type: 'fdg:gesture', ts: Date.now(), urls: ['https://chromewebstore.google.com/dl/setup.exe'], hosts: ['chromewebstore.google.com'] }, state.tabs[1]);
  await newDownload(102, 'https://cdn.example.com/files/setup.exe', 1);
  check('実行ファイルは操作ありでも遮断', state.cancelled.includes(102));

  /* 3. ユーザー操作つきの安全なファイル（アーカイブ）は許可 */
  await send({ type: 'fdg:gesture', ts: Date.now(), urls: ['https://chromewebstore.google.com/manual/theme.zip'], hosts: ['chromewebstore.google.com'] }, state.tabs[1]);
  await newDownload(103, 'https://chromewebstore.google.com/manual/theme.zip', 1);
  check('操作つきのダウンロードは許可', !state.cancelled.includes(103));

  /* 3b. 操作なしのアーカイブは遮断（理由: archive） */
  // 過去の操作だけを記録し、「操作ウィンドウ外」にする
  await send({ type: 'fdg:gesture', ts: Date.now() - 10000, urls: [], hosts: [] }, state.tabs[1]);
  await newDownload(1031, 'https://chromewebstore.google.com/auto/pack.zip', 1);
  check('操作なしのアーカイブは遮断', state.cancelled.includes(1031));
  const archEntry = (store.log || []).find((e) => e.url && e.url.indexOf('pack.zip') !== -1);
  check('アーカイブの理由ラベル', archEntry && archEntry.reason === 'archive', JSON.stringify(archEntry));

  /* 3c. 操作つきの .crx は遮断（追加拡張は常時遮断） */
  await send({ type: 'fdg:gesture', ts: Date.now(), urls: ['https://chromewebstore.google.com/x.crx'], hosts: ['chromewebstore.google.com'] }, state.tabs[1]);
  await newDownload(1032, 'https://chromewebstore.google.com/x.crx', 1);
  check('操作つきの .crx も遮断', state.cancelled.includes(1032));

  /* 4. 保護対象外タブでは触らない */
  await newDownload(104, 'https://example.com/file.exe', 2);
  check('保護対象外タブは素通し', !state.cancelled.includes(104));

  /* 5. chrome:// ページからのダウンロードは遮断 */
  await newDownload(105, 'https://cdn.example.com/x.exe', 3);
  check('chrome:// ページからの取得を遮断', state.cancelled.includes(105));

  /* 6. 拡張機能自身のページ（chrome-extension://）からの取得も遮断 */
  await newDownload(106, 'https://cdn.example.com/y.exe', 4);
  check('拡張機能ページからの取得を遮断', state.cancelled.includes(106));

  /* 7. 偽警告ページ判定後は全面遮断 */
  await send({ type: 'fdg:nag', url: 'https://chromewebstore.google.com/x' }, state.tabs[1]);
  await newDownload(107, 'https://cdn.example.com/anything.zip', 1);
  check('偽警告ページ後は全面遮断', state.cancelled.includes(107));

  /* 8. 信頼済みドメインは許可 */
  await setSettings({ trustedDomains: ['trusted.example'] });
  state.tabs[5] = { id: 5, url: 'https://trusted.example/page' };
  await newDownload(108, 'https://trusted.example/setup.exe', 5);
  check('信頼済みドメインは許可', !state.cancelled.includes(108));
  await setSettings({ trustedDomains: [] });

  /* 9. ガード OFF なら一切遮断しない */
  await setSettings({ enabled: false });
  await newDownload(109, 'https://chromewebstore.google.com/dl/setup.exe', 1);
  check('ガード OFF 時は遮断しない', !state.cancelled.includes(109));
  await setSettings({ enabled: true });

  /* 10. 履歴が保存される */
  check('ブロック履歴が保存される', (store.log || []).length > 0, 'log=' + (store.log || []).length);
  const first = (store.log || [])[0] || {};
  check('履歴に理由が記録される', !!first.reason, JSON.stringify(first));

  /* 11. 通知が出る */
  check('遮断時に通知が発生', state.notifications.length > 0);

  /* 12. scopeFor の判定 */
  const FDG = ctx.FDG;
  const s = { scope: 'stores', trustedDomains: [] };
  check('ストアは保護対象', FDG.scopeFor('https://chromewebstore.google.com/x', s).inScope);
  check('chrome:// は保護対象', FDG.scopeFor('chrome://extensions/', s).inScope);
  check('chrome-extension:// は保護対象', FDG.scopeFor('chrome-extension://abc/page.html', s).inScope);
  check('一般サイトは保護対象外', !FDG.scopeFor('https://example.com/', s).inScope);
  check('広域モードでは全ページ保護', FDG.scopeFor('https://example.com/', { scope: 'wide', trustedDomains: [] }).inScope);
  check('信頼済みは対象外', !FDG.scopeFor('https://trusted.example/', { scope: 'wide', trustedDomains: ['trusted.example'] }).inScope);
  check('.exe 判定', FDG.isExecutable('http://a/b/setup.exe') && !FDG.isExecutable('http://a/b/notes.txt'));
  check('.zip 判定', FDG.isBundle('http://a/b/x.zip') && !FDG.isBundle('http://a/b/x.txt'));
  check('.crx は追加拡張', FDG.isExtensionBundle('http://a/b/x.crx') && !FDG.isExtensionBundle('http://a/b/x.zip'));
  check('常時危険判定（exe/crx のみ）', FDG.isAlwaysDangerous('http://a/b/x.exe')
    && FDG.isAlwaysDangerous('http://a/b/x.crx') && !FDG.isAlwaysDangerous('http://a/b/x.zip'));

  /* 14. ユーザー指定の保護サイト（すべての強制DLをブロック） */
  await setSettings({ protectedSites: ['example-download.test'] });
  state.tabs[6] = { id: 6, url: 'https://example-download.test/page' };
  state.tabs[7] = { id: 7, url: 'https://sub.example-download.test/page' };

  // 保護対象として扱われる
  const sc1 = FDG.scopeFor('https://example-download.test/x', current);
  check('登録サイトは保護対象', sc1.inScope && sc1.reason === 'user-site', JSON.stringify(sc1));

  // 操作なしのダウンロードは遮断
  await newDownload(201, 'https://example-download.test/data.bin', 6);
  check('登録サイトの強制DLを遮断', state.cancelled.includes(201));

  // ユーザー操作つきのアーカイブも遮断（登録サイトは厳格）
  await send({ type: 'fdg:gesture', ts: Date.now(), urls: ['https://example-download.test/pack.zip'], hosts: ['example-download.test'] }, state.tabs[6]);
  await newDownload(202, 'https://example-download.test/pack.zip', 6);
  check('登録サイトのアーカイブは操作ありでも遮断', state.cancelled.includes(202));

  // サブドメイン（*. 登録）にも対応
  await setSettings({ protectedSites: ['*.example-download.test'] });
  const sc2 = FDG.scopeFor('https://sub.example-download.test/x', current);
  check('ワイルドカード登録はサブドメインに適用', sc2.inScope && sc2.reason === 'user-site', JSON.stringify(sc2));

  // 通常サイト（ストア以外）では操作ありのダウンロードは通る
  await setSettings({ protectedSites: ['example-download.test'] });
  await send({ type: 'fdg:gesture', ts: Date.now(), urls: ['https://other-site.test/pack.zip'], hosts: ['other-site.test'] }, state.tabs[2]);
  await newDownload(203, 'https://other-site.test/pack.zip', 2);
  check('未登録サイトは操作ありなら素通し', !state.cancelled.includes(203));

  // 入力の正規化
  check('URL正規化: 完全URL', (FDG.normalizeSiteInput('https://Example.com/path?x=1') || {}).host === 'example.com');
  check('URL正規化: ホストのみ', (FDG.normalizeSiteInput('example.com') || {}).host === 'example.com');
  check('URL正規化: ポート付き', (FDG.normalizeSiteInput('http://example.com:8080/x') || {}).host === 'example.com');
  check('URL正規化: ワイルドカード', (FDG.normalizeSiteInput('*.example.com') || {}).host === '*.example.com');
  check('URL正規化: 不正値は null', FDG.normalizeSiteInput(' javascript:alert(1) ') === null);
  check('ドメインマッチ: 完全一致', FDG.siteMatches('example.com', 'example.com'));
  check('ドメインマッチ: サブドメイン', FDG.siteMatches('a.example.com', '*.example.com'));
  check('ドメインマッチ: 不一致', !FDG.siteMatches('notexample.com', 'example.com'));

  await setSettings({ protectedSites: [] });

  /* 15. そのサイトで有効化する（セッション保護） */
  state.tabs[8] = { id: 8, url: 'https://forced-site.test/download' };
  await send({ type: 'fdg:activate', host: 'forced-site.test', persistent: false }, state.tabs[8]);
  await new Promise((r) => setTimeout(r, 20));
  check('有効化したサイトはセッション保護される',
    (sessionStore.sites || []).indexOf('forced-site.test') !== -1,
    JSON.stringify(sessionStore.sites));
  const initRes = await send({ type: 'fdg:init', url: 'https://forced-site.test/x' }, state.tabs[8]);
  check('有効化済みサイトは保護対象', initRes && initRes.inScope === true,
    JSON.stringify(initRes && initRes.reason));
  await newDownload(301, 'https://forced-site.test/auto.bin', 8);
  check('有効化サイトの強制DLを遮断', state.cancelled.includes(301));

  /* 永続（常に保護）で追加 */
  await send({ type: 'fdg:activate', host: 'always-site.test', persistent: true }, state.tabs[8]);
  await new Promise((r) => setTimeout(r, 20));
  check('永続保護は設定に保存される',
    ((store.settings && store.settings.protectedSites) || []).indexOf('always-site.test') !== -1,
    JSON.stringify(store.settings && store.settings.protectedSites));

  /* 16. 自拡張機能のテストリソースは常に保護対象 */
  await newDownload(401, 'chrome-extension://pdndkdcaipoifeljbgbkekdeojbdkagh/tests/sample.exe', 2);
  check('自拡張リソースのDLは遮断', state.cancelled.includes(401));

  /* 13. 偽警告ページの誤検知チェック */  const fakeHtml = fs.readFileSync(path.join(ROOT, 'tests/fake-update.html'), 'utf8');
  const fakeText = fakeHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const strongHits = FDG.NAG_STRONG.filter((p) => p.test(fakeText));
  const weakHits = FDG.NAG_WEAK.filter((p) => p.test(fakeText));
  check('偽警告ページ検出（強いパターン）', strongHits.length >= 1, 'strong=' + strongHits.length);
  check('偽警告ページ検出（弱いパターン）', weakHits.length >= 1, 'weak=' + weakHits.length);

  const benign = 'この拡張機能は Chrome ウェブストアで公開されています。' +
    '設定ページから自動更新のON/OFFを設定できます。サポート: お問い合わせフォームをご利用ください。';
  const benignStrong = FDG.NAG_STRONG.filter((p) => p.test(benign));
  const benignWeak = FDG.NAG_WEAK.filter((p) => p.test(benign));
  check('通常の説明文は誤検知しない', benignStrong.length === 0 && benignWeak.length < 2,
    'strong=' + benignStrong.length + ' weak=' + benignWeak.length);

  /* 出力 */
  console.log('');
  let failed = 0;
  results.forEach((r) => {
    if (!r.ok) failed++;
    console.log((r.ok ? '  PASS  ' : '  FAIL  ') + r.name + (r.extra ? '  [' + r.extra + ']' : ''));
  });
  console.log('\n' + (results.length - failed) + '/' + results.length + ' passed');
  process.exit(failed ? 1 : 0);
})();
