/* =============================================================================
 * shared.js — 共通定義
 *   ・service worker (importScripts)
 *   ・content script (js 配列で先に読み込む)
 *   ・popup (<script src>) のいずれでも同じ globalThis.FDG を使う
 * ========================================================================== */
(function (root) {
  'use strict';

  /** 保護対象となる拡張機能ストアのホスト */
  const STORE_DOMAINS = [
    'chromewebstore.google.com',
    'chrome.google.com',
    'addons.mozilla.org',
    'microsoftedge.microsoft.com',
    'addons.opera.com',
    'addons.amigo.ru',
  ];

  /** ローカル検証用（開発サーバー経由のテストページ保護） */
  const LOCAL_DOMAINS = ['localhost', '127.0.0.1'];

  /** 既定設定（background / popup / サイト管理ページで共有） */
  const DEFAULT_SETTINGS = {
    enabled: true,              // ガード全体の ON/OFF
    scope: 'stores',            // 'stores' = 拡張機能ページ＋ストアのみ / 'wide' = 全ページ
    blockExecutables: true,     // .exe / .msi などの実行ファイル
    blockBundles: true,         // .crx / .xpi などの追加拡張
    blockAutoDownloads: true,   // 操作の無い自動ダウンロード
    detectNagPages: true,       // 偽の更新・警告ページの検出
    showNotifications: true,    // ブロック時に通知
    gestureWindowMs: 2000,      // 「ユーザー操作」とみなす時間幅
    trustedDomains: [],         // 例外（信頼済み）ドメイン
    protectedSites: [],         // ユーザー指定の保護サイト（すべての強制DLをブロック）
  };

  /** 拡張機能ページとして扱うスキーム */
  const EXTENSION_PAGE_PROTOCOLS = [
    'chrome:',
    'chrome-extension:',
    'edge:',
    'brave:',
    'opera:',
    'vivaldi:',
    'moz-extension:',
  ];

  /** 実行ファイル（強制ダウンロードの主戦場） */
  const EXEC_EXTS = [
    'exe', 'msi', 'bat', 'cmd', 'scr', 'com', 'pif', 'hta',
    'ps1', 'psm1', 'vbs', 'vbe', 'jar', 'appimage',
    'msix', 'msixbundle', 'appx', 'apk', 'apks',
    'dmg', 'pkg', 'deb', 'rpm', 'sh',
  ];

  /** 追加拡張バンドル（他拡張を混入させるために使われる） */
  const EXT_BUNDLE_EXTS = ['crx', 'xpi'];

  /** アーカイブ（正規利用で Zip を取得することもあるため「強制取得」のときだけ遮断） */
  const ARCHIVE_EXTS = ['zip', 'rar', '7z', 'tar', 'tgz', 'gz', 'bz2', 'xz'];

  /** 旧来の互換（= 追加拡張 + アーカイブ） */
  const BUNDLE_EXTS = EXT_BUNDLE_EXTS.concat(ARCHIVE_EXTS);

  const EXEC_RE = new RegExp('\\.(' + EXEC_EXTS.join('|') + ')([?#].*)?$', 'i');
  const EXT_BUNDLE_RE = new RegExp('\\.(' + EXT_BUNDLE_EXTS.join('|') + ')([?#].*)?$', 'i');
  const ARCHIVE_RE = new RegExp('\\.(' + ARCHIVE_EXTS.join('|') + ')([?#].*)?$', 'i');
  const BUNDLE_RE = new RegExp('\\.(' + BUNDLE_EXTS.join('|') + ')([?#].*)?$', 'i');

  /**
   * 偽の誘導ページ検出用パターン。
   *   NAG_STRONG: 「ブラウザが終了します」「ウイルス検出」等ほぼ確実な手口
   *   NAG_WEAK  : 「更新が必要」など普通ページにも出うる表現（複数一致で判定）
   * g フラグは付けない（test() の状態付き正規表現を避けるため）。
   */
  const NAG_STRONG = [
    // 日本語
    /ブラウザ[^\n]{0,24}(終了|閉じ|停止|クラッシュ|強制終了)/,
    /(ウイルス|トロイの木馬|不正なプログラム|不正アクセス)[^\n]{0,16}(検出|見つかり|警告)/,
    /(ブラウザ|拡張機能)[^\n]{0,16}(が|は)[^\n]{0,10}(削除|無効化|ブロック)され/,
    /(緊急|重大)[^\n]{0,8}(な)?(セキュリティ)?[^\n]{0,6}(更新|修正|パッチ)/,
    // 英語
    /browser[^\n]{0,30}(will|is going to|must)[^\n]{0,20}(clos|quit|crash|shut)/i,
    /update[^\n]{0,16}your[^\n]{0,10}browser/i,
    /(critical|urgent)[^\n]{0,10}(update|security|patch)/i,
    /your[^\n]{0,10}(extension|browser)[^\n]{0,30}(has been|was)[^\n]{0,12}(updated|removed|disabled|corrupted)/i,
    /(virus|trojan|malware)[^\n]{0,20}(detected|found|warning)/i,
    /click[^\n]{0,30}(to continue|to keep browsing)[^\n]{0,20}download/i,
    // 中国語・韓国語
    /(浏览器[^\n]{0,12}(将|会)?[^\n]{0,8}(关闭|退出|崩溃))/,
    /(紧急|重要)[^\n]{0,6}(更新|升级)[^\n]{0,12}(下载|安装)/,
    /(브라우저[^\n]{0,12}(종료|종료됩니다|충돌))/,
    /(긴급|중요)[^\n]{0,6}(업데이트|보안)[^\n]{0,12}(다운로드|설치)/,
    // スペイン語
    /(el navegador[^\n]{0,20}(se (cerrará|va a cerrar)|cerrará))/i,
    /(actualizaci[oó]n|actualize)[^\n]{0,20}(cr[ií]tica|urgente)/i,
  ];

  const NAG_WEAK = [
    /(更新|アップデート)[^\n]{0,12}(必要|してください|してね|が必要です)/,
    /最新[^\n]{0,8}バージョン[^\n]{0,16}(ダウンロード|入手|インストール)/,
    /続行[^\n]{0,20}(するには|するため)[^\n]{0,20}(クリック|ダウンロード)/,
    /(再インストール|再ダウンロード)[^\n]{0,16}(してください|が必要)/,
    /download[^\n]{0,24}(the[^\n]{0,10})?(new|latest|updated)[^\n]{0,12}version/i,
  ];

  const NAG_PATTERNS = NAG_STRONG.concat(NAG_WEAK);

  /** 拡張子を取り出す（URL / ファイル名のどちらでも可） */
  function extOf(target) {
    if (!target) return '';
    let s = String(target);
    s = s.split(/[?#]/)[0];
    const m = /\.([A-Za-z0-9]{1,10})$/.exec(s);
    return m ? m[1].toLowerCase() : '';
  }

  function isExecutable(target) {
    if (!target) return false;
    return EXEC_RE.test(String(target)) || EXEC_EXTS.indexOf(extOf(target)) !== -1;
  }

  function isBundle(target) {
    if (!target) return false;
    return BUNDLE_RE.test(String(target)) || BUNDLE_EXTS.indexOf(extOf(target)) !== -1;
  }

  /** 追加拡張 (.crx / .xpi) */
  function isExtensionBundle(target) {
    if (!target) return false;
    return EXT_BUNDLE_RE.test(String(target)) || EXT_BUNDLE_EXTS.indexOf(extOf(target)) !== -1;
  }

  /** アーカイブ (.zip / .rar ...) */
  function isArchive(target) {
    if (!target) return false;
    return ARCHIVE_RE.test(String(target)) || ARCHIVE_EXTS.indexOf(extOf(target)) !== -1;
  }

  /** 実行ファイル or 追加拡張（ユーザー操作があっても常に遮断する対象） */
  function isAlwaysDangerous(target) {
    return isExecutable(target) || isExtensionBundle(target);
  }

  /** 実行ファイル or 追加拡張/アーカイブ */
  function isDangerous(target) {
    return isExecutable(target) || isBundle(target);
  }

  function hostOf(url) {
    try {
      return new URL(url).hostname;
    } catch (e) {
      return '';
    }
  }

  function isStoreHost(host) {
    return STORE_DOMAINS.indexOf(host) !== -1;
  }

  /**
   * 入力された URL をホスト名へ正規化する。
   *   "https://example.com/path?x=1" → { host: "example.com", pattern: "*://example.com/*" }
   *   "*.example.com"                 → { host: "*.example.com", pattern: "*://*.example.com/*" }
   * @returns {?{host:string, pattern:string, wildcard:boolean}}
   */
  function normalizeSiteInput(raw) {
    let s = String(raw || '').trim();
    if (!s) return null;
    s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//i, ''); // スキームを落とす
    s = s.split('/')[0].split('?')[0].split('#')[0];
    s = s.replace(/:\d+$/, '');                     // ポートを落とす
    s = s.replace(/\.$/, '');                      // 末尾ドットを落とす
    s = s.toLowerCase();
    if (!s || s.indexOf('/') !== -1 || s.indexOf('@') !== -1) return null;

    let wildcard = false;
    if (s.indexOf('*.') === 0) { wildcard = true; s = s.slice(2); }
    if (!s) return null;

    const ok = s === 'localhost'
      || /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(s);
    if (!ok) return null;

    return {
      host: wildcard ? '*.' + s : s,
      base: s,
      wildcard: wildcard,
      pattern: '*://' + (wildcard ? '*.' : '') + s + '/*',
    };
  }

  /** ホストが、指定された保護サイト（'*.' プレフィックス可）に一致するか */
  function siteMatches(host, site) {
    const h = String(host || '').toLowerCase();
    const s = String(site || '').toLowerCase();
    if (!h || !s) return false;
    if (s.indexOf('*.') === 0) {
      const base = s.slice(2);
      return h === base || h.slice(-(base.length + 1)) === '.' + base;
    }
    return h === s;
  }

  /** 保護サイト一覧から host に一致するエントリを返す */
  function findSite(host, sites) {
    const list = sites || [];
    for (const s of list) {
      if (siteMatches(host, s)) return s;
    }
    return null;
  }

  /**
   * 保護対象（スコープ内）かどうかを判定する。
   * @param {string} url  判定対象のURL
   * @param {object} settings  設定
   * @returns {{inScope:boolean, host:string, reason:string}}
   */
  function scopeFor(url, settings) {
    const s = settings || {};
    const trusted = s.trustedDomains || [];
    if (!url) return { inScope: false, host: '', reason: 'no-url' };
    let u;
    try {
      u = new URL(url);
    } catch (e) {
      return { inScope: false, host: '', reason: 'invalid-url' };
    }
    const host = u.hostname;
    if (!host) return { inScope: false, host: '', reason: 'no-host' };
    if (trusted.indexOf(host) !== -1) return { inScope: false, host: host, reason: 'trusted' };
    if (EXTENSION_PAGE_PROTOCOLS.indexOf(u.protocol) !== -1) {
      return { inScope: true, host: host, reason: 'extension-page' };
    }
    // ユーザー指定の保護サイト（すべての強制ダウンロードをブロック）
    if (findSite(host, s.protectedSites)) {
      return { inScope: true, host: host, reason: 'user-site' };
    }
    if (isStoreHost(host)) return { inScope: true, host: host, reason: 'store' };
    if (LOCAL_DOMAINS.indexOf(host) !== -1) return { inScope: true, host: host, reason: 'local-test' };
    if (s.scope === 'wide') return { inScope: true, host: host, reason: 'wide' };
    return { inScope: false, host: host, reason: 'out-of-scope' };
  }

  /** 表示用の理由ラベル */
  const REASON_LABELS = {
    executable: '実行ファイル',
    bundle: '追加拡張 (.crx/.xpi)',
    archive: 'アーカイブの強制取得',
    'no-gesture': '操作のない自動ダウンロード',
    'nag-page': '偽の警告ページからのダウンロード',
    'out-of-scope': '保護対象外',
    'user-gesture': 'ユーザー操作あり',
    'auto-check-off': '自動ダウンロード判定オフ',
    'trusted': '信頼済みドメイン',
  };

  /**
   * 固定の拡張機能 ID（manifest.json の "key" から導出）。
   * 開発者モードで読み込んでも同じ ID になるため、
   * 「今すぐ開ける URL」を bookmarks や外部から使える。
   */
  const EXTENSION_ID = 'pdndkdcaipoifeljbgbkekdeojbdkagh';

  /** 即登録用 URL: chrome-extension://<id>/activate.html?url=<url> */
  function buildAddUrl(url) {
    return 'chrome-extension://' + EXTENSION_ID + '/activate.html?url=' + encodeURIComponent(url);
  }

  /** 任意のページから「現在地」を1クリックで有効化するブックマークレット */
  function buildBookmarklet() {
    const base = 'chrome-extension://' + EXTENSION_ID + '/activate.html?url=';
    return "javascript:(function(){window.open('" + base + "'+encodeURIComponent(location.href),'_blank')})()";
  }

  root.FDG = {
    STORE_DOMAINS: STORE_DOMAINS,
    LOCAL_DOMAINS: LOCAL_DOMAINS,
    EXTENSION_PAGE_PROTOCOLS: EXTENSION_PAGE_PROTOCOLS,
    EXEC_EXTS: EXEC_EXTS,
    EXT_BUNDLE_EXTS: EXT_BUNDLE_EXTS,
    ARCHIVE_EXTS: ARCHIVE_EXTS,
    BUNDLE_EXTS: BUNDLE_EXTS,
    EXEC_RE: EXEC_RE,
    EXT_BUNDLE_RE: EXT_BUNDLE_RE,
    ARCHIVE_RE: ARCHIVE_RE,
    BUNDLE_RE: BUNDLE_RE,
    NAG_PATTERNS: NAG_PATTERNS,
    NAG_STRONG: NAG_STRONG,
    NAG_WEAK: NAG_WEAK,
    REASON_LABELS: REASON_LABELS,
    DEFAULT_SETTINGS: DEFAULT_SETTINGS,
    EXTENSION_ID: EXTENSION_ID,
    buildAddUrl: buildAddUrl,
    buildBookmarklet: buildBookmarklet,
    extOf: extOf,
    isExecutable: isExecutable,
    isBundle: isBundle,
    isExtensionBundle: isExtensionBundle,
    isArchive: isArchive,
    isAlwaysDangerous: isAlwaysDangerous,
    isDangerous: isDangerous,
    hostOf: hostOf,
    isStoreHost: isStoreHost,
    normalizeSiteInput: normalizeSiteInput,
    siteMatches: siteMatches,
    findSite: findSite,
    scopeFor: scopeFor,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
