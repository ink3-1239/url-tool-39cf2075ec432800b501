/* =============================================================================
 * guard-isolated.js — 隔離ワールドで動作するガード
 *
 *  1. 直近の「本物のユーザー操作」をバックグラウンドへ通知し、
 *     操作を伴わない自動ダウンロードだけを遮断できるようにする
 *  2. ページ内の危険なリンク / フォーム送信 / meta refresh を抑止
 *  3. 偽の「更新が必要」「ブラウザが終了します」型のページを検出して警告
 * ========================================================================== */
(function () {
  'use strict';

  const FDG = globalThis.FDG;
  if (!FDG) return;
  // 静的登録と動的登録（広域モード）が同時に当选するのを防ぐ
  if (window.__fdgIsolatedInstalled) return;
  window.__fdgIsolatedInstalled = true;

  const state = {
    settings: null,
    inScope: false,
    nagShown: false,
    toastHost: null,
  };

  /* ============================================================ 初期化 ==== */
  chrome.runtime.sendMessage({ type: 'fdg:init', url: location.href })
    .then((res) => {
      if (!res || !res.ok) return;
      state.settings = res.settings;
      state.inScope = res.inScope;
      if (!res.inScope || !res.settings.enabled) return;
      install();
      // ユーザー指定の保護サイトなら「保護中」インジケータを出す
      if (res.reason === 'user-site') showProtectedBadge();
    })
    .catch(() => { /* 拡張機能が無効など */ });

  /* ================================================== ユーザー操作の記録 = */
  let gestureTimer = null;
  function noteGesture(e) {
    if (!state.inScope) return;
    // スクリプトが作出的な click()（isTrusted=false）はユーザー操作として数えない
    if (e && e.isTrusted === false) return;
    const now = Date.now();
    const urls = [];
    let el = null;
    try {
      el = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    } catch (err) { el = null; }
    if (el) {
      try { urls.push(new URL(el.href, location.href).href); } catch (err) { /* noop */ }
    }
    const hosts = urls.map((u) => FDG.hostOf(u)).filter(Boolean);
    if (gestureTimer) clearTimeout(gestureTimer);
    gestureTimer = setTimeout(() => {
      chrome.runtime.sendMessage({ type: 'fdg:gesture', ts: now, urls: urls, hosts: hosts })
        .catch(() => {});
    }, 60);
  }

  document.addEventListener('pointerdown', noteGesture, true);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') noteGesture(e);
  }, true);
  document.addEventListener('click', noteGesture, true);

  /* ========================================================== 抑止処理 ==== */
  function install() {
    installLinkGuard();
    installFormGuard();
    installMetaRefreshGuard();
    installNagDetector();
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg && msg.type === 'fdg:blocked') {
        showToast(msg.file || msg.url || '(不明なファイル)', msg.reason);
      }
    });
  }

  function installLinkGuard() {
    document.addEventListener('click', (e) => {
      let a = null;
      try { a = e.target && e.target.closest ? e.target.closest('a[href]') : null; } catch (err) { a = null; }
      if (!a) return;
      const href = a.href || '';
      if (!href) return;
      // ユーザー操作による正規の Zip 取得まで壊さないよう、常時遮断するのは
      // 実行ファイルと追加拡張 (.crx/.xpi) のみ。
      if (!FDG.isAlwaysDangerous(href)) return;
      e.preventDefault();
      e.stopPropagation();
      showToast(href.split('/').pop() || href, FDG.isExecutable(href) ? 'executable' : 'bundle');
    }, true);
  }

  function installFormGuard() {
    document.addEventListener('submit', (e) => {
      const form = e.target;
      if (!form || !form.getAttribute) return;
      const action = form.getAttribute('action') || '';
      let abs = action;
      try { abs = new URL(action || location.href, location.href).href; } catch (err) { /* noop */ }
      if (!FDG.isDangerous(abs)) return;
      e.preventDefault();
      e.stopPropagation();
      showToast(abs.split('/').pop() || abs, FDG.isExecutable(abs) ? 'executable' : 'bundle');
    }, true);
  }

  function installMetaRefreshGuard() {
    function sweep() {
      try {
        const nodes = document.querySelectorAll('meta[http-equiv]');
        for (const el of nodes) {
          if ((el.getAttribute('http-equiv') || '').toLowerCase() !== 'refresh') continue;
          const content = el.getAttribute('content') || '';
          const target = content.replace(/^\s*\d+\s*;\s*url\s*=\s*/i, '').trim();
          if (!target) continue;
          let abs = target;
          try { abs = new URL(target, location.href).href; } catch (err) { /* noop */ }
          if (!FDG.isDangerous(abs)) continue;
          el.remove();
          showToast(abs.split('/').pop() || abs, FDG.isExecutable(abs) ? 'executable' : 'bundle');
        }
      } catch (err) { /* noop */ }
    }
    sweep();
    try {
      const mo = new MutationObserver(() => sweep());
      mo.observe(document, { childList: true, subtree: true, attributes: true });
    } catch (err) { /* noop */ }
  }

  /* ============================================== 偽警告ページの検出 ==== */
  function installNagDetector() {
    if (!state.settings.detectNagPages) return;
    let timer = null;
    const check = () => {
      timer = null;
      if (!state.inScope || state.nagShown) return;
      if (!document.body) return;

      let text = '';
      try { text = (document.body.innerText || '').slice(0, 30000); } catch (err) { text = ''; }
      const strong = FDG.NAG_STRONG.filter((p) => p.test(text));
      const weak = FDG.NAG_WEAK.filter((p) => p.test(text));

      let dangerLinks = 0;
      try {
        const links = document.querySelectorAll('a[href]');
        for (const a of links) if (FDG.isAlwaysDangerous(a.href)) dangerLinks++;
      } catch (err) { /* noop */ }

      // 強い手口が 1 件ある、または弱い手口が 2 件以上、
      // もしくは「危険なリンク」がある場合に偽誘導ページとみなす
      const isNag = strong.length >= 1 || weak.length >= 2 || (dangerLinks >= 1 && (strong.length + weak.length) >= 1);
      if (!isNag) return;
      state.nagShown = true;
      chrome.runtime.sendMessage({
        type: 'fdg:nag',
        url: location.href,
        hits: strong.length + weak.length,
        dangerLinks: dangerLinks,
      }).catch(() => {});
      showBanner(strong.length + weak.length, dangerLinks);
    };

    const schedule = () => { if (!timer) timer = setTimeout(check, 800); };

    document.addEventListener('DOMContentLoaded', schedule);
    window.addEventListener('load', schedule);
    try {
      const mo = new MutationObserver(schedule);
      const start = () => mo.observe(document, { childList: true, subtree: true, characterData: true });
      if (document.documentElement) start();
      else document.addEventListener('readystatechange', function once() {
        if (document.documentElement) { document.removeEventListener('readystatechange', once); start(); }
      });
    } catch (err) { /* noop */ }
    schedule();
  }

  /* ========================================================== UI 作製 ==== */
  function ensureHost() {
    if (state.toastHost && state.toastHost.isConnected) return state.toastHost;
    const host = document.createElement('div');
    host.id = 'fdg-ui-host';
    host.style.cssText = 'all:initial;position:fixed;z-index:2147483647;';
    const shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = `
      .fdg-banner {
        position: fixed; top: 12px; left: 12px; right: 12px; max-width: 760px;
        margin: 0 auto; z-index: 2147483647;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Hiragino Sans", "Noto Sans JP", sans-serif;
        background: #fff7ed; color: #7c2d12; border: 2px solid #f97316; border-radius: 12px;
        box-shadow: 0 10px 30px rgba(0,0,0,.25); padding: 14px 16px; font-size: 14px; line-height: 1.6;
      }
      .fdg-banner h3 { margin: 0 0 6px; font-size: 15px; font-weight: 700; }
      .fdg-banner p { margin: 0 0 10px; }
      .fdg-btn {
        appearance: none; border: 1px solid #f97316; background: #f97316; color: #fff;
        border-radius: 8px; padding: 7px 12px; font-size: 13px; cursor: pointer; margin-right: 8px;
      }
      .fdg-btn.ghost { background: transparent; color: #7c2d12; }
      .fdg-toast {
        position: fixed; right: 16px; bottom: 16px; max-width: 380px;
        z-index: 2147483647; background: #b91c1c; color: #fff; border-radius: 10px;
        box-shadow: 0 8px 24px rgba(0,0,0,.3); padding: 12px 14px; font-size: 13px; line-height: 1.55;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Hiragino Sans", "Noto Sans JP", sans-serif;
      }
      .fdg-toast .fdg-title { font-weight: 700; margin-bottom: 4px; }
      .fdg-toast .fdg-sub { opacity: .9; word-break: break-all; }
      .fdg-badge {
        position: fixed; left: 16px; bottom: 16px; z-index: 2147483647;
        background: rgba(21,128,61,.94); color: #fff; border-radius: 999px;
        padding: 7px 14px; font-size: 12px; font-weight: 600; cursor: pointer;
        box-shadow: 0 6px 18px rgba(0,0,0,.28);
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Hiragino Sans", "Noto Sans JP", sans-serif;
      }
    `;
    shadow.appendChild(style);
    (document.body || document.documentElement).appendChild(host);
    state.toastHost = host;
    return host;
  }

  function showBanner(hits, dangerLinks) {
    try {
      const host = ensureHost();
      const shadow = host.shadowRoot;
      const box = document.createElement('div');
      box.className = 'fdg-banner';
      box.innerHTML = `
        <h3>⚠ 自動ダウンロードの誘導ページです</h3>
        <p>このページは「ブラウザが終了します」「更新が必要」などの文言で
        ファイルの取得を誘導している可能性があります。強制ダウンロード ガードが
        このページからの自動ダウンロードをブロックしています。</p>
        <p style="opacity:.8">検出: 文言 ${hits} 件 / 危険なリンク ${dangerLinks} 件</p>
        <button class="fdg-btn" data-act="allow">このサイトでのダウンロードを許可</button>
        <button class="fdg-btn ghost" data-act="close">閉じる</button>
      `;
      box.querySelector('[data-act="allow"]').addEventListener('click', () => {
        chrome.runtime.sendMessage({ type: 'fdg:allow-domain', host: location.hostname })
          .catch(() => {});
        box.remove();
      });
      box.querySelector('[data-act="close"]').addEventListener('click', () => box.remove());
      shadow.appendChild(box);
    } catch (err) { /* noop */ }
  }

  /** 保護対象サイトであることを示す小さなインジケータ */
  function showProtectedBadge() {
    try {
      const host = ensureHost();
      const shadow = host.shadowRoot;
      if (shadow.querySelector('.fdg-badge')) return;
      const box = document.createElement('div');
      box.className = 'fdg-badge';
      box.innerHTML = '🛡 保護中 — このサイトの強制ダウンロードはブロックされます';
      box.addEventListener('click', () => box.remove());
      shadow.appendChild(box);
    } catch (err) { /* noop */ }
  }

  function showToast(file, reason) {
    try {
      const host = ensureHost();
      const shadow = host.shadowRoot;
      const label = (FDG.REASON_LABELS && FDG.REASON_LABELS[reason]) || reason || '';
      const box = document.createElement('div');
      box.className = 'fdg-toast';
      box.innerHTML = `
        <div class="fdg-title">🛡 ダウンロードをブロックしました</div>
        <div class="fdg-sub">${String(file).replace(/[<>&]/g, '')}<br>理由: ${String(label).replace(/[<>&]/g, '')}</div>
      `;
      shadow.appendChild(box);
      setTimeout(() => box.remove(), 8000);
    } catch (err) { /* noop */ }
  }
})();
