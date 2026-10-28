/* =============================================================================
 * activate.js — 「そのサイトで強制ダウンロードを止める」の実行ページ
 *
 *   ブックマークレット / アドレスバー / 深いリンクから
 *   chrome-extension://<id>/activate.html?url=<対象URL> で開かれる。
 * ========================================================================== */
(function () {
  'use strict';

  const FDG = globalThis.FDG;
  const $ = (id) => document.getElementById(id);

  function setStatus(text, kind) {
    const el = $('status');
    if (!text) { el.hidden = true; el.textContent = ''; return; }
    el.hidden = false;
    el.textContent = text;
    el.className = 'status' + (kind ? ' ' + kind : '');
  }

  async function start() {
    $('version').textContent = 'v' + chrome.runtime.getManifest().version;

    const params = new URLSearchParams(location.search);
    const raw = params.get('url') || params.get('host') || '';
    const n = FDG.normalizeSiteInput(raw);

    if (!n) {
      const ex = $('explain');
      ex.hidden = false;
      ex.textContent = '対象サイトの URL が取得できませんでした。'
        + 'そのサイトを開いた状態で、このページを開いてください。';
      $('activate').disabled = true;
      return;
    }

    $('target-host').textContent = n.host;
    $('target-url').textContent = raw;

    // 既に有効ならその旨を出す
    try {
      const data = await chrome.storage.session.get(['sites']);
      const sites = data.sites || [];
      if (sites.indexOf(n.host) !== -1) {
        setStatus('このサイトはすでに保護されています（このセッション中）。', 'ok');
        $('activate').textContent = '再適用する';
      }
    } catch (e) { /* noop */ }

    $('activate').addEventListener('click', async () => {
      const btn = $('activate');
      btn.disabled = true;
      btn.textContent = '処理中…';

      let granted = false;
      try {
        granted = await chrome.permissions.request({ origins: [n.pattern] });
      } catch (e) { granted = false; }

      if (!granted) {
        // 許可が無くても「この site's全部のダウンロードを止める」ことはできる
        const res = await chrome.runtime.sendMessage({
          type: 'fdg:activate', host: n.host, persistent: $('keep').checked,
        }).catch(() => null);
        setStatus('アクセス許可は拒否されました。'
          + 'このサイトのすべてのダウンロードをブロックしました'
          + ((res && res.count) ? '（' + res.count + ' タブに適用）' : '') + '。', 'warn');
        btn.disabled = false;
        btn.textContent = 'このサイトで強制DLを止める';
        return;
      }

      const res = await chrome.runtime.sendMessage({
        type: 'fdg:activate', host: n.host, persistent: $('keep').checked,
      }).catch(() => null);

      setStatus('このサイトで強制ダウンロードを止めました。'
        + ((res && res.count) ? '（開いている ' + res.count + ' タブにも適用済み）' : '')
        + ($('keep').checked ? '／ 常に保護します。' : '／ ブラウザ再起動まで有効。'), 'ok');
      btn.textContent = '✔ 有効になりました';
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
