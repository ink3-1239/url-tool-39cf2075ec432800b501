/* =============================================================================
 * sites.js — 保護サイト管理ページ
 *
 *   1. 欄 に URL を入れて「決定」を押す
 *   2. ury URL を開くと即登録（?add=<url>）
 *   3. 拡張機能が入っていないブラウザ（プレビュー）でも単体で動く
 * ========================================================================== */
(function () {
  'use strict';

  const FDG = globalThis.FDG;
  const $ = (id) => document.getElementById(id);
  const LS_KEY = 'fdg.protectedSites';

  let settings = Object.assign({}, FDG.DEFAULT_SETTINGS);
  let standalone = false;      // 拡張機能として読み込まれていない（プレビュー等）
  let memory = [];             // localStorage が使えない environments 用の退避

  /* ------------------------------------------------------- 保存の切替 ---- */
  function inExtension() {
    return typeof chrome !== 'undefined'
      && chrome.storage && chrome.storage.local
      && chrome.runtime && chrome.runtime.id;
  }

  function readLocal() {
    try {
      const raw = window.localStorage.getItem(LS_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) { /* localStorage 不可 */ }
    return memory.slice();
  }

  function writeLocal(list) {
    memory = list.slice();
    try { window.localStorage.setItem(LS_KEY, JSON.stringify(list)); } catch (e) { /* noop */ }
  }

  /* ------------------------------------------------------------ 状態 ---- */
  function setStatus(text, kind) {
    const el = $('status');
    if (!text) { el.hidden = true; el.textContent = ''; return; }
    el.hidden = false;
    el.textContent = text;
    el.className = 'status' + (kind ? ' ' + kind : '');
  }

  async function load() {
    if (standalone) {
      settings.protectedSites = readLocal();
      return;
    }
    const data = await chrome.storage.local.get(['settings']);
    settings = Object.assign({}, FDG.DEFAULT_SETTINGS, data.settings || {});
  }

  async function save() {
    if (standalone) {
      writeLocal(settings.protectedSites || []);
      return;
    }
    await chrome.storage.local.set({ settings: settings });
  }

  /* ------------------------------------------------------------ 描画 --- */
  async function hasPermission(pattern) {
    if (standalone) return false;
    try {
      return await chrome.permissions.contains({ origins: [pattern] });
    } catch (e) { return false; }
  }

  async function render() {
    const list = $('site-list');
    list.innerHTML = '';
    const sites = settings.protectedSites || [];
    $('site-count').textContent = String(sites.length);
    $('site-empty').classList.toggle('hidden', sites.length > 0);

    for (const site of sites) {
      const n = FDG.normalizeSiteInput(site);
      if (!n) continue;
      const granted = await hasPermission(n.pattern);

      const li = document.createElement('li');

      const host = document.createElement('span');
      host.className = 'host';
      host.textContent = n.host;

      const mode = document.createElement('span');
      mode.className = 'mode' + (granted ? '' : ' strict');
      mode.textContent = granted ? '強制DLのみ遮断' : 'すべてのDLを遮断';
      mode.title = granted
        ? '操作検知が動作するため、ユーザーの操作を伴うダウンロードは通ります。'
        : 'アクセス許可がないため操作を検知できず、すべてのダウンロードを遮断します。';

      const spacer = document.createElement('span');
      spacer.className = 'spacer';

      // アクセス許可が無く、かつ拡張機能模式下なら許可ボタンを出す
      if (!granted && !standalone) {
        const grant = document.createElement('button');
        grant.className = 'grant';
        grant.textContent = 'アクセス許可';
        grant.title = '許可すると「強制DLのみ遮断」に切り替わります';
        grant.addEventListener('click', async () => {
          let ok = false;
          try { ok = await chrome.permissions.request({ origins: [n.pattern] }); } catch (e) { ok = false; }
          setStatus(ok
            ? '「' + n.host + '」へのアクセスを許可しました。'
            : 'アクセス許可が拒否されました。すべてのダウンロードを遮断したままです。',
            ok ? 'ok' : 'warn');
          await render();
        });
        li.appendChild(grant);
      }

      const del = document.createElement('button');
      del.className = 'del';
      del.textContent = '削除';
      del.addEventListener('click', async () => {
        settings.protectedSites = (settings.protectedSites || []).filter((s) => s !== site);
        await save();
        await render();
        setStatus('「' + n.host + '」を削除しました。', 'ok');
        try { await chrome.permissions.remove({ origins: [n.pattern] }); } catch (e) { /* noop */ }
      });

      li.appendChild(host);
      li.appendChild(mode);
      li.appendChild(spacer);
      li.appendChild(del);
      list.appendChild(li);
    }
  }

  /* --------------------------------------------------------- 追加処理 --- */
  /** 入力値から「開ける URL」を作る（'*.' は外す） */
  function browsableUrl(raw) {
    let s = String(raw || '').trim();
    if (!s) return null;
    if (s.indexOf('*.') === 0) s = s.slice(2);
    if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
    return s;
  }

  /** 登録直後に、開いているタブへガードを注入する */
  async function protectNow(host) {
    if (standalone) return 0;
    try {
      const res = await chrome.runtime.sendMessage({ type: 'fdg:protect-now', host: host });
      return (res && res.count) || 0;
    } catch (e) { return 0; }
  }

  async function addSite(raw, opts) {
    const options = opts || {};
    const n = FDG.normalizeSiteInput(raw);
    if (!n) {
      setStatus('URL を正しく入力してください（例: https://example.com/）', 'error');
      return false;
    }

    const sites = settings.protectedSites || [];
    if (sites.some((s) => FDG.siteMatches(n.host, s) || FDG.siteMatches(s, n.host))) {
      setStatus('「' + n.host + '」はすでに登録されています。', 'warn');
      return false;
    }

    // アクセス許可の要求はユーザー操作の中で行う必要がある。
    // 深いリンク (?add=) で開いた場合は操作がないため要求できず、
    // 「すべてのDLを遮断」モードで登録し、後から許可できるようにする。
    let granted = false;
    if (!standalone && !options.deepLink) {
      try { granted = await chrome.permissions.request({ origins: [n.pattern] }); } catch (e) { granted = false; }
    } else if (!standalone) {
      granted = await hasPermission(n.pattern);
    }

    // 実体の保存・注入はバックグラウンドに一元化させる
    const persistent = options.persistent !== false;
    let injected = 0;
    if (!standalone) {
      const res = await chrome.runtime.sendMessage({
        type: 'fdg:activate', host: n.host, persistent: persistent,
      }).catch(() => null);
      injected = (res && res.count) || 0;
      await load();   // バックグラウンドが保存した設定を読み直す
    } else {
      settings.protectedSites = sites.concat([n.host]);
      await save();
    }
    await render();

    // 「サイトを開く」リンク
    const linkBox = $('open-links');
    const link = $('open-link');
    const openUrl = browsableUrl(raw);
    if (linkBox && link && openUrl) {
      link.href = openUrl;
      linkBox.hidden = false;
    }

    if (standalone) {
      setStatus('「' + n.host + '」を登録しました（プレビュー環境のためこのブラウザ内のみに保存）。'
        + '拡張機能に入れるには下の「拡張機能へ渡す」を使ってください。', 'ok');
    } else if (granted) {
      setStatus('「' + n.host + '」を保護対象に追加しました。'
        + 'このサイト上では、強制ダウンロード（操作のない自動ダウンロード）と'
        + '実行ファイル・アーカイブをブロックします。'
        + (injected ? '（開いている ' + injected + ' タブにも即座に適用しました）' : ''), 'ok');
    } else {
      setStatus('「' + n.host + '」を保護対象に追加しました。'
        + 'アクセス許可が未設定のため、このサイトのすべてのダウンロードを遮断します。'
        + '（一覧の「アクセス許可」ボタンで許可できます）', 'warn');
    }
    return true;
  }

  /* ------------------------------------------- 深いリンク (?add=) 処理 --- */
  async function handleDeepLink() {
    const params = new URLSearchParams(location.search);
    const add = params.get('add');
    const prefill = params.get('url');

    if (prefill) {
      $('site-input').value = prefill;
      $('site-input').focus();
      $('site-input').select();
    }

    if (!add) return;

    // 同じページでリロードしても二重登録されないよう URL から除く
    const clean = location.pathname + location.hash;
    try { history.replaceState(null, '', clean); } catch (e) { /* noop */ }

    await addSite(add, { deepLink: true, persistent: false });
  }

  /* -------------------------------------------------------- 初期化 ----- */
  async function start() {
    standalone = !inExtension();
    $('version').textContent = 'v' + (standalone ? 'preview' : chrome.runtime.getManifest().version);
    document.body.classList.toggle('standalone', standalone);
    if (standalone) {
      // 拡張機能 APIs が無い環境では使えないボタンを隠す
      const b = $('add-current');
      if (b) b.disabled = true;
      const p = $('open-popup');
      if (p) p.style.display = 'none';
    }

    $('open-popup').addEventListener('click', () => {
      if (standalone) return;
      chrome.tabs.create({ url: chrome.runtime.getURL('popup.html') });
    });

    // 拡張機能内なら、manifest の key から求めた固定 ID を使う
    const extId = FDG.EXTENSION_ID;

    // 即登録 URL とブックマークレット
    $('deeplink').value = 'chrome-extension://' + extId + '/sites.html?add=https://example.com';
    $('bookmarklet').value = FDG.buildBookmarklet();
    $('copy-bookmarklet').addEventListener('click', async () => {
      const bm = FDG.buildBookmarklet();
      try {
        await navigator.clipboard.writeText(bm);
        setStatus('ブックマークレットの URL をコピーしました（ブックマークの URL 欄に貼り付けてください）。', 'ok');
      } catch (e) {
        setStatus('コピーできませんでした。上のテキストを手動でコピーしてください。', 'warn');
      }
    });

    // 現在のタブを「追加」するボタン（1クリック）
    $('add-current').addEventListener('click', async () => {
      let url = '';
      try {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        url = (tabs && tabs[0] && tabs[0].url) || '';
      } catch (e) { url = ''; }
      if (!url) { setStatus('現在のタブの URL を取得できませんでした。', 'error'); return; }
      await addSite(url, {});
    });

    // 拡張機能を開くだけの URL（拡張機能に入っていない環境向けの導線）
    $('open-in-extension').addEventListener('click', () => {
      const first = (settings.protectedSites || [])[0];
      const target = first ? FDG.buildAddUrl(first) : 'chrome-extension://' + extId + '/sites.html';
      window.open(target, '_blank');
    });

    // 一覧をコピー（拡張機能へ手動で渡す用）
    $('copy-json').addEventListener('click', async () => {
      const json = JSON.stringify(settings.protectedSites || [], null, 2);
      try {
        await navigator.clipboard.writeText(json);
        setStatus('保護サイト一覧をコピーしました。', 'ok');
      } catch (e) {
        setStatus('コピーできませんでした。一覧を手動で選択してコピーしてください。', 'warn');
      }
    });

    // フォーム送信（決定）: 登録して、そのサイトを新しいタブで開く
    const form = $('site-form');
    const input = $('site-input');
    const submit = $('site-submit');

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const value = input.value;
      if (!value) { input.focus(); return; }
      submit.disabled = true;
      const ok = await addSite(value, { open: true });
      submit.disabled = false;
      if (ok) {
        input.value = '';
        // 守りが有効な状態で作業できるよう、登録したサイトを開く
        const openUrl = browsableUrl(value);
        if (openUrl && !standalone) {
          try { chrome.tabs.create({ url: openUrl }); } catch (err) { /* noop */ }
        }
      }
      input.focus();
    });

    // 「登録のみ」
    $('site-open').addEventListener('click', async () => {
      const value = input.value;
      if (!value) { input.focus(); return; }
      const ok = await addSite(value, { open: false });
      if (ok) {
        input.value = '';
        input.focus();
      }
    });

    await load();
    await render();
    await handleDeepLink();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
