/* =============================================================================
 * popup.js — 設定 UI
 *   最優先の操作は「いま開いているサイトで強制ダウンロードを止める」。
 * ========================================================================== */
(function () {
  'use strict';

  const FDG = globalThis.FDG;
  const DEFAULTS = FDG.DEFAULT_SETTINGS;

  const $ = (id) => document.getElementById(id);
  let settings = Object.assign({}, DEFAULTS);
  let sessionSites = [];
  let currentTab = null;

  /* ------------------------------------------------------------ 保存 ---- */
  async function save(patch) {
    settings = Object.assign({}, settings, patch);
    await chrome.storage.local.set({ settings: settings });
  }

  async function loadSessionSites() {
    try {
      const data = await chrome.storage.session.get(['sites']);
      sessionSites = data.sites || [];
    } catch (e) { sessionSites = []; }
  }

  /* ------------------------------------------------------- 現在のタブ ---- */
  async function refreshTabStatus() {
    const el = $('tab-status');
    const hero = $('hero-target');
    const pill = $('state-pill');
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      currentTab = (tabs && tabs[0]) || null;
    } catch (e) { currentTab = null; }

    const url = (currentTab && currentTab.url) || '';
    const n = FDG.normalizeSiteInput(url);
    const scope = FDG.scopeFor(url, Object.assign({}, settings, {
      protectedSites: (settings.protectedSites || []).concat(sessionSites),
    }));
    const host = FDG.hostOf(url) || '(拡張機能ページ)';

    if (!settings.enabled) {
      el.textContent = 'ガードは無効です — ' + host;
      el.className = 'tab-status unprotected';
      pill.textContent = 'OFF';
      pill.className = 'pill off';
    } else if (scope.inScope) {
      el.textContent = 'このサイトは保護中です — ' + host;
      el.className = 'tab-status protected';
      pill.textContent = '保護中';
      pill.className = 'pill on';
    } else {
      el.textContent = 'このサイトは未保護 — ' + host;
      el.className = 'tab-status unprotected';
      pill.textContent = '未保護';
      pill.className = 'pill';
    }

    if (!n) {
      hero.textContent = 'このタブは保護できません（拡張機能ページや内部画面です）';
      $('activate').disabled = true;
      return;
    }
    const isOn = sessionSites.indexOf(n.host) !== -1
      || (settings.protectedSites || []).indexOf(n.host) !== -1;
    hero.textContent = n.host;
    $('activate').textContent = isOn ? 'このサイトの保護を適用し直す' : 'このサイトで強制DLを止める';
  }

  /* --------------------------------------------------------- 設定描画 --- */
  function render() {
    $('enabled').checked = settings.enabled;
    $('blockExecutables').checked = settings.blockExecutables;
    $('blockBundles').checked = settings.blockBundles;
    $('blockAutoDownloads').checked = settings.blockAutoDownloads;
    $('detectNagPages').checked = settings.detectNagPages;
    $('showNotifications').checked = settings.showNotifications;
    const radios = document.querySelectorAll('input[name="scope"]');
    radios.forEach((r) => { r.checked = (r.value === settings.scope); });
    renderDomains();
    renderSites();
  }

  function renderDomains() {
    const list = $('domain-list');
    list.innerHTML = '';
    (settings.trustedDomains || []).forEach((host) => {
      const li = document.createElement('li');
      const span = document.createElement('span');
      span.textContent = host;
      const btn = document.createElement('button');
      btn.textContent = '✕';
      btn.title = '削除';
      btn.addEventListener('click', async () => {
        const next = (settings.trustedDomains || []).filter((h) => h !== host);
        await save({ trustedDomains: next });
        renderDomains();
        refreshTabStatus();
      });
      li.appendChild(span);
      li.appendChild(btn);
      list.appendChild(li);
    });
  }

  function renderSites() {
    const list = $('site-list');
    list.innerHTML = '';
    const sites = settings.protectedSites || [];
    $('site-count').textContent = String(sites.length);
    if (!sites.length) {
      const li = document.createElement('li');
      const span = document.createElement('span');
      span.textContent = '（未登録）';
      span.style.color = 'var(--muted)';
      li.appendChild(span);
      list.appendChild(li);
      return;
    }
    sites.forEach((host) => {
      const li = document.createElement('li');
      const span = document.createElement('span');
      span.textContent = host;
      const btn = document.createElement('button');
      btn.textContent = '✕';
      btn.title = '削除';
      btn.addEventListener('click', async () => {
        const next = (settings.protectedSites || []).filter((h) => h !== host);
        await save({ protectedSites: next });
        renderSites();
        refreshTabStatus();
      });
      li.appendChild(span);
      li.appendChild(btn);
      list.appendChild(li);
    });
  }

  /* ----------------------------------------------------------- 履歴 ----- */
  async function renderLog(preloaded) {
    let log = preloaded;
    if (!log) {
      const data = await chrome.storage.local.get(['log']);
      log = data.log || [];
    }
    const list = $('log-list');
    list.innerHTML = '';
    $('log-count').textContent = String(log.length);
    $('log-empty').classList.toggle('hidden', log.length > 0);
    log.slice(0, 20).forEach((e) => {
      const li = document.createElement('li');
      const file = document.createElement('div');
      file.className = 'file';
      file.textContent = e.file || e.url || '(不明)';
      const meta = document.createElement('div');
      meta.className = 'meta';
      const when = new Date(e.t || Date.now());
      const hh = String(when.getHours()).padStart(2, '0');
      const mm = String(when.getMinutes()).padStart(2, '0');
      const ss = String(when.getSeconds()).padStart(2, '0');
      meta.textContent = hh + ':' + mm + ':' + ss + ' ／ ' +
        (FDG.REASON_LABELS[e.reason] || e.reason || '') +
        (e.host ? ' ／ ' + e.host : '');
      li.appendChild(file);
      li.appendChild(meta);
      list.appendChild(li);
    });
  }

  /* ------------------------------------------------- 広域モード権限 ----- */
  async function ensureWidePermission() {
    const has = await chrome.permissions.contains({ origins: ['<all_urls>'] });
    const warn = $('perm-warning');
    if (has) {
      warn.classList.add('hidden');
      return true;
    }
    warn.classList.remove('hidden');
    warn.textContent = '「全ページ（広域モード）」を使うには「すべてのサイト」のアクセス許可が必要です。';
    return false;
  }

  /* ----------------------------------------------- このサイトを有効化 --- */
  async function activateCurrentSite() {
    const url = (currentTab && currentTab.url) || '';
    const n = FDG.normalizeSiteInput(url);
    const status = $('activate-status');
    if (!n) {
      status.hidden = false;
      status.className = 'status error';
      status.textContent = 'このタブは保護できません。';
      return;
    }

    const btn = $('activate');
    btn.disabled = true;
    const original = btn.textContent;
    btn.textContent = '処理中…';

    // アクセス許可（ユーザー操作の中で要求できる）
    let granted = false;
    try {
      granted = await chrome.permissions.request({ origins: [n.pattern] });
    } catch (e) { granted = false; }

    const persistent = $('keep').checked;
    const res = await chrome.runtime.sendMessage({
      type: 'fdg:activate', host: n.host, persistent: persistent,
    }).catch(() => null);

    await loadSessionSites();
    await refreshTabStatus();

    status.hidden = false;
    if (granted) {
      status.className = 'status ok';
      status.textContent = '✔ このサイトで強制ダウンロードを止めました。'
        + ((res && res.count) ? '（' + res.count + ' タブに適用）' : '')
        + (persistent ? '／ 常に保護します。' : '／ ブラウザ再起動まで有効。');
    } else {
      status.className = 'status warn';
      status.textContent = 'アクセス許可は拒否されました。'
        + 'このサイトのすべてのダウンロードをブロックしました。';
    }
    btn.disabled = false;
    btn.textContent = original;
  }

  /* --------------------------------------------- アイフレームのテスト ---- */
  /** テスト用の iframe にガードを差し込む（拡張機能ページは同一オリジン） */
  function injectTestGuard(frame) {
    try {
      const win = frame.contentWindow;
      if (!win) return;
      [chrome.runtime.getURL('shared.js'),
       chrome.runtime.getURL('guard-isolated.js'),
       chrome.runtime.getURL('guard-main.js')].forEach((u) => {
        const s = win.document.createElement('script');
        s.src = u;
        s.async = false;
        (win.document.head || win.document.documentElement).appendChild(s);
      });
    } catch (e) { /* noop */ }
  }

  function initTester() {
    const frame = $('test-frame');
    const status = $('test-status');
    if (!frame) return;

    frame.addEventListener('load', () => { injectTestGuard(frame); });

    chrome.runtime.onMessage.addListener((msg) => {
      if (!msg || msg.type !== 'fdg:blocked-event') return;
      status.className = 'test-status ok';
      status.textContent = '✔ ブロックしました: ' + (msg.file || msg.url || '')
        + '（' + (FDG.REASON_LABELS[msg.reason] || msg.reason || '') + '）';
    });

    $('reload-tester').addEventListener('click', () => {
      status.className = 'test-status';
      status.textContent = '⏳ 4 秒後に強制ダウンロードを試みます…';
      frame.src = frame.src;
    });

    $('open-tester').addEventListener('click', () => {
      chrome.tabs.create({ url: chrome.runtime.getURL('tester.html') });
      window.close();
    });
  }

  /* ----------------------------------------------------------- 初期化 --- */
  /** プレビュー表示（拡張機能を読み込んでいないとき）用のデモデータ */
  function applyPreviewData() {
    settings = Object.assign({}, DEFAULTS, {
      trustedDomains: ['example.com'],
      protectedSites: ['example.com', '*.example.jp'],
    });
    sessionSites = ['demo-site.test'];
    currentTab = { id: 1, url: 'https://demo-site.test/downloads' };
    $('preview-note').hidden = false;
    $('version').textContent = 'v1.0.0（プレビュー）';
    render();
    refreshTabStatus();
    renderLog([{
      t: Date.now() - 120000, file: 'browser-update-setup.exe',
      reason: 'executable', host: 'demo-site.test',
    }, {
      t: Date.now() - 60000, file: 'pack.zip',
      reason: 'archive', host: 'demo-site.test',
    }, {
      t: Date.now() - 10000, file: 'report.pdf',
      reason: 'no-gesture', host: 'shop.example.com',
    }]);
  }

  async function init() {
    // 拡張機能以外（プレビュー用の HTML を開いた場合など）では停止する
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
      applyPreviewData();
      const st = $('test-status');
      if (st) {
        st.className = 'test-status warn';
        st.textContent = 'プレビューでは実行できません。拡張機能として読み込むと、この場で'
          + '強制ダウンロードの阻止を確認できます。';
      }
      return;
    }

    const data = await chrome.storage.local.get(['settings']);
    settings = Object.assign({}, DEFAULTS, data.settings || {});
    await loadSessionSites();
    render();
    await refreshTabStatus();
    await renderLog();
    await ensureWidePermission();
    $('version').textContent = 'v' + chrome.runtime.getManifest().version;

    initTester();
    $('activate').addEventListener('click', activateCurrentSite);

    ['blockExecutables', 'blockBundles', 'blockAutoDownloads', 'detectNagPages', 'showNotifications']
      .forEach((id) => {
        $(id).addEventListener('change', (e) => save({ [id]: e.target.checked }));
      });

    document.querySelectorAll('input[name="scope"]').forEach((r) => {
      r.addEventListener('change', async (e) => {
        if (e.target.value !== 'wide') {
          await save({ scope: 'stores' });
          await ensureWidePermission();
          refreshTabStatus();
          return;
        }
        const granted = await chrome.permissions.request({ origins: ['<all_urls>'] });
        if (granted) {
          await save({ scope: 'wide' });
          $('perm-warning').classList.add('hidden');
        } else {
          await save({ scope: 'stores' });
          $('perm-warning').classList.remove('hidden');
          $('perm-warning').textContent = '権限が拒否されたため「拡張機能ページ＋ストアのみ」に戻しました。';
        }
        render();
        refreshTabStatus();
      });
    });

    $('add-domain').addEventListener('click', async () => {
      const input = $('domain-input');
      let host = (input.value || '').trim().toLowerCase();
      host = host.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
      if (!host) return;
      const list = (settings.trustedDomains || []).slice();
      if (list.indexOf(host) === -1) list.push(host);
      await save({ trustedDomains: list });
      input.value = '';
      renderDomains();
      refreshTabStatus();
    });

    $('domain-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') $('add-domain').click();
    });

    $('clear-log').addEventListener('click', async () => {
      await chrome.storage.local.set({ log: [] });
      renderLog();
    });

    $('open-test').addEventListener('click', () => {
      chrome.tabs.create({ url: chrome.runtime.getURL('tester.html') });
      window.close();
    });

    $('open-sites').addEventListener('click', () => {
      chrome.tabs.create({ url: chrome.runtime.getURL('sites.html') });
      window.close();
    });

    $('reset').addEventListener('click', async () => {
      await chrome.storage.local.set({ settings: Object.assign({}, DEFAULTS) });
      settings = Object.assign({}, DEFAULTS);
      render();
      refreshTabStatus();
    });
  }

  init();
})();
