# 強制ダウンロード ガード (Force Download Guard)

Chrome / Edge 向けの Manifest V3 拡張機能です。
**そのサイトを開いている場所で「強制ダウンロード」を止める**ことを目的にしています。

- クリックも 없이自動でファイルを取得する（強制ダウンロード）
- `.exe` / `.msi` / `.dmg` などの実行ファイル、`.crx` / `.xpi` などの追加拡張
- 「ブラウザが終了します」「更新が必要」などの偽警告ページによる誘導

を 3 層（content script / ダウンロード API / ネットワーク層）でブロックします。

> English README: [README.en.md](./README.en.md)

---

## 0. 使い方 — そのサイトで有効化する

この拡張機能は「登録してから使う」のではなく、**そのサイトを開いている場所で有効化**する
使い方を第一に設計しています。保護対象の ID を固定してあるので（manifest の `key`）、
以下の URL はどの環境でも同じです。

| やりたいこと | 操作 |
| --- | --- |
| **いま開いているサイトで止める**（いちばん多い使い方） | ツールバーの盾アイコン → **「このサイトで強制DLを止める」**（1 クリック） |
| アドレスバーから | アドレスバーに `guard`（または `ガード`）と打って **Enter** |
| 任意のページから 1 クリック | 管理ページのブックマークレットをブックマークバーへ置く |
| URL を開くだけ | `chrome-extension://pdndkdcaipoifeljbgbkekdeojbdkagh/activate.html?url=https://example.com` |
| 常に保護する | 管理ページ `chrome-extension://pdndkdcaipoifeljbgbkekdeojbdkagh/sites.html` に URL を入れて **「決定」** |

有効化すると、

1. その页面の左下に **「🛡 保護中」** バッジが出ます（クリックで消せます）
2. そのサイトでの強制ダウンロード（操作のない自動ダウンロード・実行ファイル・追加拡張・
   アーカイブの強制取得）がすべて止まります
3. 開いているタブには再読み込みなしで即座に適用されます
   （`chrome.scripting.executeScript` による即時注入）
4. 既定では **ブラウザを閉じるまで** 有効です。「常に保護する」を選ぶと保存されます

アクセス許可（そのサイトへのホスト権限）を拒んだ場合は、
操作を検知できないため**そのサイトのすべてのダウンロード**を遮断します。

---

## 1. インストール

> 📖 **公開する（GitHub へ push する／Chrome ウェブストアへ出す）手順は
> [PUBLISH.md](./PUBLISH.md) に、より詳しく書きました。**
> はじめて公開する場合はこちらを参照してください。

### GitHub から（ Releases）

1. Releases ページから `force-download-guard-<version>.zip` をダウンロードして解凍
2. `chrome://extensions`（Edge なら `edge://extensions`）を開く
3. 右上の「**開発者モード**」を ON
4. 「**展開して読み込み**」をクリック → 解凍したフォルダを選ぶ

### ソースから

```bash
git clone https://github.com/ink3-1239/url-tool-39cf2075ec432800b501.git
# → chrome://extensions → 開発者モード ON → 展開して読み込み
#   → url-tool-39cf2075ec432800b501/force-download-guard/
```

manifest の `key` で拡張機能 ID を固定しているので、導入後の URL は常に同じです。

```
chrome-extension://pdndkdcaipoifeljbgbkekdeojbdkagh/popup.html     設定
chrome-extension://pdndkdcaipoifeljbgbkekdeojbdkagh/sites.html    保護サイト管理
chrome-extension://pdndkdcaipoifeljbgbkekdeojbdkagh/activate.html  そのサイトで有効化
```

---

## 2. 3 層の防御

| 層 | 担当 | 止める対象 |
| --- | --- | --- |
| ① ページ側抑止 | `guard-main.js`（MAIN ワールド）/ `guard-isolated.js`（隔離ワールド） | `a.click()` による自動取得、`window.open` / `location.href` への遷移、`form.submit()`、`meta refresh`、危険なリンクのクリック |
| ② ダウンロード判定 | `background.js`（`chrome.downloads`） | 「ユーザー操作なし」のダウンロード、実行ファイル／追加拡張、偽警告ページからのダウンロード。`chrome.downloads.cancel()` で中止し、履歴と通知を記録 |
| ③ ネットワーク層 | `declarativeNetRequest` | 保護対象ページを起点とした `.exe` などのリクエストを URL 段階でブロック |

判定のポイントは ② の「**直近 2 秒以内に本物のユーザー操作（pointerdown / click / Enter）があるかどうか**」です。
スクリプトが自動で `.click()` を呼んでも操作イベント自体は発生しないため、
強制ダウンロードだけを正確に拾い、用户在中の正規ダウンロードは通します。

---

## 3. 設定（ツールバーのアイコン → ポップアップ）

| 項目 | 既定 | 内容 |
| --- | --- | --- |
| このサイトで強制DLを止める | — | 最優先の操作。いまのタブのサイトを有効化（チェックを入れると恒久保存） |
| ガードを有効にする | ON | 全体を ON/OFF |
| 保護範囲 | 拡張機能ページ＋ストア | 「全ページ（広域モード）」にすると任意サイトの誘導ページも対象。選択時に「すべてのサイト」の許可を要求 |
| 実行ファイルをブロック | ON | `.exe .msi .bat .cmd .scr .com .pif .hta .ps1 .vbs .jar .appimage .msix .appx .apk .dmg .pkg .deb .rpm .sh` |
| 追加拡張をブロック | ON | `.crx .xpi`（他の拡張機能を混入させる手口） |
| 操作のない自動ダウンロードをブロック | ON | ユーザー操作を伴わないダウンロードを遮断（`.zip .rar .7z` 等の強制取得も含む） |
| 偽の更新・警告ページを検出 | ON | ページ内に警告文言があれば警告バナー＋そのタブのダウンロードを全面遮断 |
| ブロック時に通知を表示 | ON | OS 通知を表示 |
| 常に保護するサイト | 空 | ブラウザを閉じても保護が続くサイト（管理ページで追加） |
| 信頼済みドメイン | 空 | 例外ドメイン（保護対象から外れ、ダウンロード許可） |

保護対象のホスト: `chromewebstore.google.com` / `chrome.google.com` / `addons.mozilla.org` /
`microsoftedge.microsoft.com` / `addons.opera.com` ＋ `chrome://` `chrome-extension://` `edge://` などの
拡張機能ページ ＋ ユーザー指定の保護サイト ＋ `localhost`（検証用）。

### 遮断のポリシー

| 種別 | ユーザー操作あり | ユーザー操作なし |
| --- | --- | --- |
| 実行ファイル `.exe` ほか | 遮断 | 遮断 |
| 追加拡張 `.crx` / `.xpi` | 遮断 | 遮断 |
| アーカイブ `.zip` / `.rar` ほか | 許可（正規の Zip 取得を壊さない） | 遮断 |
| その他のファイル | 許可 | 遮断 |

偽警告ページ（強い手口が 1 件以上、または弱い手口が 2 件以上、危険なリンクがある）と判定されたタブでは、
偽の「ダウンロード」ボタンを押した場合も遮断します。

---

## 4. 動作確認

### A. アイフレームテスター

ポップアップの「**テスト：強制ダウンロードを阻止してみる**」にはアイフレーム嵌入のテストが用意されています。
左の偽の更新ページが 4 秒後に自動でファイルを取得しようとすると、**拡張機能が止める**結果が右側に表示されます
（詳細ページ: `tester.html` / ポップアップの「テストページを開く」）。

`tester.html` は偽ページ（`tests/fake-update.html`）を iframe に読み込み、同じオリジンのスクリプトを差し込んで
ガードを実際に動作させています。偽ページ内の警告バナー（黄色い帯）もそのまま表示されます。

### B. 偽警告ページの検出（要ローカルサーバー）

```bash
cd force-download-guard/tests
python3 -m http.server 8000
# → http://localhost:8000/fake-update.html を開く
```

`localhost` は既定で保護対象なので、警告バナーが出て自動ダウンロードが 2 つともブロックされます。

---

## 5. 権限とプライバシー

| 権限 | 用途 |
| --- | --- |
| `downloads` | ダウンロードの開始を検知し、強制ダウンロードを中断する |
| `tabs` / `webNavigation` | ダウンロードの起点ページ（保護対象か判定）を特定する |
| `declarativeNetRequest` | 危険な URL へのリクエストをネットワーク層で遮断する |
| `scripting` | 有効化したサイトへ抑止スクリプトを差し込む／広域モードで全ページへ |
| `omnibox` | アドレスバーで `guard` と打ったときの有効化 |
| `notifications` | ブロック時の通知 |
| `storage` | 設定・ブロック履歴・一時保護対象の保存（**外部送信なし・すべて端末内**） |
| ホスト許可 | 拡張機能ストア と `localhost`（検証用）。広域モード時は `<all_urls>`、サイト有効化時は対象サイトのオリジンをユーザー操作で要求 |

- 外部通信（テレメトリ・外部 API）は一切行いません。
- ブロック履歴は `chrome.storage.local` のみ、一時的な有効化は `chrome.storage.session` に保存され、
  ブラウザを閉じると破棄されます。
- ホスト権限は、ユーザーが「許可」したサイトに対してのみ取得します。

---

## 6. ファイル構成

```
force-download-guard/
├── manifest.json          拡張機能定義（MV3・ID 固定の key を含む）
├── shared.js              共通定義（保護対象判定・拡張子・警告文言パターン・URL 正規化）
├── background.js          Service Worker：ダウンロード判定・遮断・履歴・通知・omnibox
├── guard-isolated.js      隔離ワールド：操作の記録・DOM 抑止・偽警告検出・警告 UI
├── guard-main.js          MAIN ワールド：a.click() / window.open / location / meta refresh の抑止
├── popup.html / .js       設定 UI（最優先カード「このサイトで強制DLを止める」）
├── sites.html / .js       保護サイト管理ページ（URL を打って「決定」）
├── activate.html / .js    そのサイトで有効化するページ（ブックマークレット・深いリンク用）
├── tester.html / .js      アイフレームで強制DLの阻止を再現するテストページ
├── popup.css / sites.css / tester.css
│                         CSS の正本（各 HTML にはビルド時に埋め込まれる）
├── PUBLISH.md             公開ガイド（GitHub へ push／Chrome ストアへ出す手順）
├── icons/                 アイコン
├── _locales/ja/           日本語リソース
├── tests/                 動作確認用ページ（偽警告ページ・強制ダウンロード再現）
├── tools/make-icons.py    アイコン生成
├── tools/selftest.js      判定ロジックの自動テスト
├── tools/smoke-sites.js   管理ページの起動テスト
├── tools/smoke-guard.js   操作検知（isTrusted 判定）のテスト
├── tools/build-html.py    CSS を各 HTML に埋め込むビルド
├── tools/publish-github.sh GitHub への push を 1 コマンドで行う補助スクリプト
├── tools/package.py       リリース用 zip の生成
└── tools/serve.py         拡張機能を入れずに管理ページを開くための配信サーバー
```

> **CSS は各 HTML に埋め込み済みです。**
> HTML 1 ファイルだけダウンロードして開いても、CSS が読み込まれずに
> 「まったく違う見た目」になる現象が起きません。
> CSS を直するときは `*.css` を編集して `python3 tools/build-html.py` を実行してください。

---

## 7. 開発

```bash
node tools/selftest.js     # 判定ロジック（遮断/許可の分岐・誤検知） → 46/46 passed
node tools/smoke-sites.js  # 管理ページ起動（deep link・決定ボタン） → 9/9 passed
node tools/smoke-guard.js  # 操作検知（スクリプト作出クリックを数えない） → 3/3 passed
python3 tools/build-html.py       # CSS → 各 HTML への埋め込み
python3 tools/build-html.py --check # 埋め込みが最新か確認（CI でも実行）
python3 tools/package.py   # → dist/force-download-guard-<version>.zip
python3 tools/serve.py 8000   # → http://localhost:8000/sites.html（単体ブラウザで動く）
```

GitHub Actions（`.github/workflows/`）で、push 時に上記テストを自動実行し、
タグを push 時にリリース用の zip を作成して Release を公開します。

### GitHub Pages で管理ページを公開する（任意）

`Settings → Pages → Source: / (root)` を有効にすると
`https://<owner>.github.io/<repo>/sites.html` で管理ページを単体ブラウザで開けます
（拡張機能を入れずに一覧を作成できます）。

---

## 8. 既知の制限

- `chrome://` などの内部ページには content script を注入できない（Chrome の制約）ため、
  内部ページでの抑止は ②（ダウンロード API）と ③（ネットワーク層）で補っています。
- 実行ファイルを拡張子なしで配信する（`/dl?id=123` のような URL）場合は、
  ②の「最終ファイル名での判定（`onDeterminingFilename`）」で捕捉します。
- ブラウザが「実行ファイルをダウンロードしますか？」の確認ダイアログを出す場合、
  ②が先に `cancel()` するためファイルは保存されません。

---

## 9. ライセンス

MIT — [LICENSE](./LICENSE) を参照してください。
