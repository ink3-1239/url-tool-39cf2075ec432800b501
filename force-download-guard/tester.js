/* =============================================================================
 * tester.js — アイフレームで「強制ダウンロード」を再現し、
 *              拡張機能が止めるまでの結果を表示するテストページ
 * ========================================================================== */
(function () {
  'use strict';

  const FDG = globalThis.FDG;
  const $ = (id) => document.getElementById(id);

  let blocked = 0;
  let allowed = 0;

  /* ---------------------------------------------------- ガードの注入 ---- */
  /**
   * テスト用の iframe（拡張機能自身のページ）は content script の対象外なので、
   * 同一オリジンとして直接スクリプトを差し込む。
   */
  function injectGuard(frame) {
    try {
      const win = frame.contentWindow;
      if (!win) return;
      const urls = [
        chrome.runtime.getURL('shared.js'),
        chrome.runtime.getURL('guard-isolated.js'),
        chrome.runtime.getURL('guard-main.js'),
      ];
      urls.forEach((u) => {
        const s = win.document.createElement('script');
        s.src = u;
        s.async = false;
        (win.document.head || win.document.documentElement).appendChild(s);
      });
    } catch (e) {
      console.warn('[FDG] テストフレームへの注入に失敗:', e && e.message);
    }
  }

  /* --------------------------------------------------------- 結果表示 --- */
  function addResult(entry) {
    const list = $('result-list');
    const li = document.createElement('li');
    if (entry.action === 'allowed') {
      li.className = 'allowed';
      allowed++;
    } else {
      blocked++;
    }
    const when = new Date(entry.t || Date.now());
    const hh = String(when.getHours()).padStart(2, '0');
    const mm = String(when.getMinutes()).padStart(2, '0');
    const ss = String(when.getSeconds()).padStart(2, '0');

    const file = document.createElement('div');
    file.className = 'r-file';
    file.textContent = (entry.action === 'allowed' ? '✔ 許可: ' : '❌ ブロック: ') + (entry.file || entry.url || '(不明)');

    const reason = document.createElement('div');
    reason.className = 'r-reason';
    reason.textContent = hh + ':' + mm + ':' + ss + ' ／ '
      + (FDG.REASON_LABELS[entry.reason] || entry.reason || '') +
      (entry.host ? ' ／ ' + entry.host : '');

    li.appendChild(file);
    li.appendChild(reason);
    list.insertBefore(li, list.firstChild);

    $('result-empty').hidden = true;
    $('c-blocked').textContent = String(blocked);
    $('c-allowed').textContent = String(allowed);
    $('c-total').textContent = String(blocked + allowed);
  }

  /* ------------------------------------------------------------ 初期化 --- */
  function start() {
    $('version').textContent = 'v' + chrome.runtime.getManifest().version;

    const frame = $('test-frame');
    frame.addEventListener('load', () => {
      // 読み込み直後にガードを差し込む（偽ページの 4 秒タイマーに間に合う）
      injectGuard(frame);
    });

    // バックグラウンドからの遮断通知
    chrome.runtime.onMessage.addListener((msg) => {
      if (!msg) return;
      if (msg.type === 'fdg:blocked-event') addResult(msg);
    });

    $('reload').addEventListener('click', () => {
      blocked = 0;
      allowed = 0;
      $('c-blocked').textContent = '0';
      $('c-allowed').textContent = '0';
      $('c-total').textContent = '0';
      $('result-list').innerHTML = '';
      $('result-empty').hidden = false;
      frame.src = frame.src;
    });

    $('open-fake').addEventListener('click', () => {
      chrome.tabs.create({ url: chrome.runtime.getURL('tests/fake-update.html') });
    });

    $('open-popup').addEventListener('click', () => {
      chrome.tabs.create({ url: chrome.runtime.getURL('popup.html') });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
