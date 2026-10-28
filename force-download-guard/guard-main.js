/* =============================================================================
 * guard-main.js — ページ本体（MAIN ワールド）側で動作する抑止スクリプト
 *
 * content script は隔離ワールドで動くため、ページの JavaScript が
 * 書き換えた window.open / location / a.click() を直接止められない。
 * そこで MAIN ワールドで実行し、危険な URL への遷移自体を止めに行く。
 * ========================================================================== */
(function () {
  'use strict';

  if (window.__fdgMainInstalled) return;
  window.__fdgMainInstalled = true;

  var EXEC_RE = /\.(exe|msi|bat|cmd|scr|com|pif|hta|ps1|psm1|vbs|vbe|jar|appimage|msixbundle|msix|appx|apk|apks|dmg|pkg|deb|rpm|sh)([?#].*)?$/i;
  var BUNDLE_RE = /\.(crx|xpi|zip|rar|7z|tar|tgz|gz|bz2|xz)([?#].*)?$/i;

  function isDanger(url) {
    if (typeof url !== 'string' || !url) return false;
    return EXEC_RE.test(url) || BUNDLE_RE.test(url);
  }

  function report(kind, url) {
    try {
      window.postMessage({ __fdg: true, kind: kind, url: String(url).slice(0, 500) }, '*');
    } catch (e) { /* noop */ }
  }

  /* ------------------------------------------------ a.click() の抑止 ----- */
  try {
    var origClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      var href = '';
      try { href = this.href || ''; } catch (e) { href = ''; }
      if (isDanger(href)) {
        report('blocked-click', href);
        return;
      }
      return origClick.apply(this, arguments);
    };
  } catch (e) { /* noop */ }

  /* ------------------------------------------------ window.open の抑止 --- */
  try {
    var origOpen = window.open;
    window.open = function (url) {
      if (isDanger(url)) {
        report('blocked-open', url);
        return null;
      }
      return origOpen.apply(window, arguments);
    };
  } catch (e) { /* noop */ }

  /* ---------------------------------------- location への遷移の抑止 ----- */
  try {
    var proto = window.Location && window.Location.prototype;
    if (proto) {
      ['assign', 'replace'].forEach(function (name) {
        var orig = proto[name];
        if (typeof orig !== 'function') return;
        proto[name] = function (url) {
          if (isDanger(url)) {
            report('blocked-navigate', url);
            return;
          }
          return orig.apply(this, arguments);
        };
      });

      var hrefDesc = Object.getOwnPropertyDescriptor(proto, 'href');
      if (hrefDesc && hrefDesc.configurable && hrefDesc.set) {
        Object.defineProperty(proto, 'href', {
          configurable: true,
          enumerable: hrefDesc.enumerable,
          get: hrefDesc.get,
          set: function (v) {
            if (isDanger(v)) {
              report('blocked-navigate', v);
              return;
            }
            return hrefDesc.set.call(this, v);
          },
        });
      }
    }
  } catch (e) { /* noop */ }

  /* ------------------------------------------------ form.submit の抑止 --- */
  try {
    var origSubmit = HTMLFormElement.prototype.submit;
    HTMLFormElement.prototype.submit = function () {
      var action = '';
      try { action = this.action || ''; } catch (e) { action = ''; }
      if (isDanger(action)) {
        report('blocked-submit', action);
        return;
      }
      return origSubmit.apply(this, arguments);
    };
  } catch (e) { /* noop */ }

  /* ------------------------------------------ meta refresh の除去 ------- */
  function stripMetaRefresh(root) {
    try {
      var nodes = root.querySelectorAll ? root.querySelectorAll('meta[http-equiv]') : [];
      for (var i = 0; i < nodes.length; i++) {
        var el = nodes[i];
        if ((el.getAttribute('http-equiv') || '').toLowerCase() !== 'refresh') continue;
        var content = el.getAttribute('content') || '';
        var target = content.replace(/^\s*\d+\s*;\s*url\s*=\s*/i, '').trim();
        if (isDanger(target)) {
          report('blocked-meta-refresh', target);
          el.remove();
        }
      }
    } catch (e) { /* noop */ }
  }

  function startObserver() {
    try {
      var mo = new MutationObserver(function (mutations) {
        for (var i = 0; i < mutations.length; i++) {
          var added = mutations[i].addedNodes;
          for (var j = 0; j < added.length; j++) {
            var node = added[j];
            if (node.nodeType !== 1) continue;
            if (node.tagName === 'META') stripMetaRefresh(node.parentNode || document);
            else if (node.querySelectorAll) stripMetaRefresh(node);
          }
        }
      });
      mo.observe(document, { childList: true, subtree: true });
    } catch (e) { /* noop */ }
  }

  if (document.documentElement) startObserver();
  else document.addEventListener('readystatechange', function once() {
    if (document.documentElement) {
      document.removeEventListener('readystatechange', once);
      startObserver();
    }
  });
})();
