# 公開ガイド（GitHub → Chrome ウェブストア）

このガイドは **「公開したい」の意味が分からない人向け**に、公開までの流れを
1 コマンドずつ、わかりやすいように書いたものです。大きく 2 つの作業があります。

```
  ① GitHub に公開する  ──→  ソースコードを公開（開発者・利用者・Issue を受ける場所）
  ② Chrome ウェブストアに公開する  ──→  一般ユーザーが普通にインストールできる形にする
```

> すでに両方済んでいる場合は、該当する箇所だけ読んでください。

---

## 0. 全体像

```
  ┌─ ローカル ─────────────────────────────┐
  │  cd /home/user/force-download-guard    │
  │  python3 tools/package.py --out dist   │  ← 配布用の zip を作る
  │  → dist/force-download-guard-1.0.0.zip │
  └───────────────┬────────────────────────┘
                  │
      ┌───────────┴────────────┐
      ▼                        ▼
  ① GitHub に push        ② Chrome ウェブストアへ zip をアップロード
      │                        │
      ├─ ソース公開              ├─ 一般ユーザー向け
      ├─ Issue / PR 受付        ├─ 自動更新
      └─ Release に zip 貼付け   └─ ストアページで公開
```

---

## 1. GitHub に公開する

### 1-1. アカウントを作る

- <https://github.com/join> でアカウントを作成します（無料）。
- 無料で使える「Free」プランで十分です。

### 1-2. 公開先リポジトリ

| 項目 | 値 |
| --- | --- |
| 所有者 | `ink3-1239` |
| リポジトリ | `url-tool-39cf2075ec432800b501` |
| URL | `https://github.com/ink3-1239/url-tool-39cf2075ec432800b501` |
| 拡張機能の置き場所 | **`force-download-guard/`（サブディレクトリ）** |

このリポジトリはすでにある HTML ツール集なので、**ルートには置かず
`force-download-guard/` サブディレクトリ**に拡張機能一式を入れます。
`chrome://extensions` →「展開して読み込み」で選ぶのも、このフォルダを指定すれば OK です。

> リポジトリのルート直下（`index.html` など）には触りません。既存ファイルを壊さないためです。

### 1-3. 初回 push（コマンド解説）

```bash
cd /home/user

# ① リポジトリを落とす（すでにあるclone を使い回してよい）
git clone https://github.com/ink3-1239/url-tool-39cf2075ec432800b501.git

# ② 拡張機能を force-download-guard/ サブディレクトリへコピー
cp -r force-download-guard url-tool-39cf2075ec432800b501/force-download-guard

# ③ コピー掉了不要なフォルダを削除（.git と CI はpush しない）
rm -rf url-tool-39cf2075ec432800b501/force-download-guard/.git
rm -rf url-tool-39cf2075ec432800b501/force-download-guard/.github
rm -rf url-tool-39cf2075ec432800b501/force-download-guard/dist

# ④ コミットして push
cd url-tool-39cf2075ec432800b501
git add force-download-guard
git commit -m "feat: 強制ダウンロード ガード (Chrome 拡張機能) を追加"
git push origin main
```

> ⚠️ ③ で `.git` を消さないと、**サブディレクトリが別リポジトリ扱い**になって push できません。
> ④ の `git push` は GitHub の認証を求めます（下の Personal Access Token を使います）。

#### もっと簡単にするなら（補助スクリプト）

上の ①〜④ は **1 つのスクリプト**にまとめてあります。

```bash
cd /home/user/force-download-guard
bash tools/publish-github.sh
```

clone → サブディレクトリへコピー → commit → push まで自動で、
push の時だけ認証を求めます。コミットメッセージを変えたいときは

```bash
bash tools/publish-github.sh "fix: 強制ダウンロード判定の修正"
```

`git push` 時に **ユーザー名とパスワード（ Personal Access Token）を聞かれます**。
パスワードの代わりに Token を使います:

1. GitHub 右上 → プロフィール → **Settings** → 左 **Developer settings**
2. 左 **Personal access tokens** → **Tokens (classic)** → **Generate new token (classic)**
3. 名前を付けて **必要な権限だけ** を選び → `repo` チェック → Generate
4. 表示されたトークン（`ghp_...`）をパスワード欄に入力します

> もっと簡単にするなら GitHub Desktop / VS Code の GUI から push しても OK です。

### 1-4. リポジトリの設定を補完する

push が終わったら、GitHub のリポジトリ画面で次の設定をします。

| 場所 | 設定 | 理由 |
| --- | --- | --- |
| `Settings → General` | **Description** を入力 | 一覧で説明が見られる |
| `Settings → General` | **Topics** に `chrome-extension`, `manifest-v3`, `security`, `download-blocker` | 検索に引っかかる |
| `Settings → Pages` | Source: `/ (root)` | 管理ページ `sites.html` を Web で公開できる（任意） |
| リポジトリ右の `About` | Website / Topics を編集 | 同上 |

### 1-5. Release を作る（配布用の zip を自動で貼る）

タグを push すると、GitHub Actions が自動で **配布用 zip を作って Release に貼ります**。

```bash
# バージョンを上げる（manifest.json の version も 1.0.0 → 1.1.0 に直す）
cd /home/user/force-download-guard
python3 tools/package.py --out dist

# 変更をサブディレクトリへコピーして commit
cd /home/user
rm -rf url-tool-39cf2075ec432800b501/force-download-guard
cp -r force-download-guard url-tool-39cf2075ec432800b501/force-download-guard
rm -rf url-tool-39cf2075ec432800b501/force-download-guard/.git
rm -rf url-tool-39cf2075ec432800b501/force-download-guard/.github
rm -rf url-tool-39cf2075ec432800b501/force-download-guard/dist
cd url-tool-39cf2075ec432800b501
git add force-download-guard
git commit -m "chore: v1.1.0"
git push origin main

# タグを立てて push（← これが Release を作るトリガー）
git tag v1.1.0
git push origin v1.1.0
```

数十秒後、リポジトリの **Releases** ページに
`force-download-guard-1.1.0.zip` が自動で添付されます。

> タグを push する前にも CI が走ります（テストが全部通っていないと Release は作られません）。

### 1-6. 公開後の URL

| 目的 | URL |
| --- | --- |
| ソース（拡張機能） | `https://github.com/ink3-1239/url-tool-39cf2075ec432800b501/tree/main/force-download-guard` |
| 配布 zip | `https://github.com/ink3-1239/url-tool-39cf2075ec432800b501/releases` |
| 拡張機能を直接開く | `https://github.com/ink3-1239/url-tool-39cf2075ec432800b501/blob/main/force-download-guard/README.md` |

> `force-download-guard/` はサブディレクトリなので、**拡張機能の zip をReleases に置く場合だけ**
> .store への提出は Releases の zip ではなく `dist/` でビルドした zip を使ってください。

---

## 2. Chrome ウェブストアに公開する

### 2-1. 開発者登録（最初に 1 回だけ）

1. <https://chrome.google.com/webstore/devconsole> を開く
2. Google アカウントでログイン
3. 料金（個人開発者は **一度だけ 5 ドル**。 年次ではなく一度のみです）
4. 個人情報（名前・住所・電話番号など）を入力して登録

> 登録が承認されるまで **数時間〜数日** かかることがあります。

### 2-2. 提出前のチェックリスト

| 項目 | 確認 |
| --- | --- |
| zip が最新 | `python3 tools/package.py --out dist` を実行済み |
| テストが全部通る | `node tools/selftest.js` / `smoke-sites.js` / `smoke-guard.js` |
| manifest のバージョン | `manifest.json` の `version` が上がっている |
| 名前 / 説明 | `_locales/ja/messages.json`（ストア一覧にも使われる） |
| アイコン | `icons/icon128.png` が 128×128 |
| 権限 | README の権限表と実際の manifest が一致している |

```bash
# まとめて確認する
cd /home/user/force-download-guard
python3 tools/build-html.py --check \
  && node tools/selftest.js \
  && node tools/smoke-sites.js \
  && node tools/smoke-guard.js \
  && python3 tools/package.py --out dist \
  && echo "全部 OK"
```

### 2-3. ストア掲載情報

デベロッパーコンソール → **「新しいアイテム」** → **「zip をアップロード」**
（`dist/force-download-guard-<version>.zip` をドラッグ＆ドロップ）

| 項目 | 入力する内容 |
| --- | --- |
| languages | 日本語 |
| Name | `強制ダウンロード ガード` |
| Short description（短めの説明・最大 132 文字） | `そのサイトで強制ダウンロードを止める。実行ファイル・追加拡張・偽の更新ページをブロックします。` |
| Description（詳細・最大 16,000 文字） | 下記をコピペ |
| Category | **Productivity**（生产力） |
| Icon | `icons/icon128.png` |
| Screenshots | 1280×800 または 640×400 の PNG/JPG（最低 1 枚） |

**Description のコピペ用テキスト**

```text
自動でファイルを取得する「強制ダウンロード」をブロックする Chrome 拡張機能です。

■ できること
・そのサイトを開いている場所で「強制ダウンロード」を即座に止める
・クリックもないのに自動でファイルをDLする挙動を検知して中止
・実行ファイル（.exe / .msi / .dmg など）を常にブロック
・他の拡張機能を混入させる .crx / .xpi を常にブロック
・「ブラウザが終了します」「更新が必要」などの偽警告ページを検出

■ 使い方
1. ツールバーの盾アイコンを押す
2. 「このサイトで強制DLを止める」を押す
3. そのページで強制ダウンロードが止まる（保護中バッジが出る）

アドレスバーに「guard」と打って Enter でも同じことができます。
ブラウザを閉じるまで有効な「一時保護」と、毎回保存する「常に保護する」を選べます。

■ プライバシー
外部サーバーへの送信は一切ありません。設定・履歴はすべて手元のブラウザ内に保存されます。
ホスト権限は、あなたが「許可」したサイトに対してのみ取得されます。

■ 対応ブラウザ
Chrome / Edge（Manifest V3）
```

### 2-4. プライバシー表記

ストアの **Privacy practices** フォームでは:

| 質問 | 答え |
| --- | --- |
| 収集するユーザー情報 | **なし（No data collected）** |
| ユーザーのデータを送信するか | **いいえ** |
| 収集するデータ | **なし** |
| 広告・マーケティング目的での使用 | **いいえ** |
| 第三者への共有 | **いいえ** |

> この拡張機能は外部通信を一切行わないので、すべて「なし」で回答できます。

### 2-5. 審査で除此之外されないポイント

Chrome ストアは、**ホスト権限の範囲が広すぎないか**を注意深く見ます。次の 2 点をストアの説明にも書いておくと審査がスムーズです。

1. **「単一の目的」** を明記する
   → 「強制ダウンロードをブロックする」を 1 つの目的として書く
2. **ホスト権限がなぜ必要か** を説明する
   → 「ユーザーが『このサイトで強制DLを止める』を選んだとき、
     そのサイトでのみスクリプトを注入し、強制ダウンロードの操作有無を判定するため」

### 2-6. 公開する

1. デベロッパーコンソールで **「公開」**（Publish）を押す
2. 通常 **数時間〜数日** でレビューが完了し、ストアに並びます
3. 公開後、ストア URL は `https://chromewebstore.google.com/detail/<ID>/<slug>` になります

### 2-7. 公開後の自動更新

- ストアに公開したあとの新しいバージョンは、**同じ Dev Console から「新しいバージョン」をアップロード**します
- ストアは **公開から数時間〜数日かけて** ユーザーへ配布します（自動更新）
- GitHub の Release とは独立した流れです（両方 release してください）

---

## 3. バージョンを上げる（毎回すること）

```bash
cd /home/user/force-download-guard

# 1. manifest.json の version を上げる
#    "version": "1.0.0"  →  "version": "1.1.0"

# 2. CSS を HTML に埋め込み（CSS を触ったなら必須）
python3 tools/build-html.py

# 3. テスト
node tools/selftest.js && node tools/smoke-sites.js && node tools/smoke-guard.js

# 4. zip を作る
python3 tools/package.py --out dist

# 5. GitHub にRelease
git add -A && git commit -m "release: v1.1.0" && git push origin main
git tag v1.1.0 && git push origin v1.1.0

# 6. Chrome ストアにも同じ zip をアップロード（Dev Console → 新しいバージョン）
```

---

## 4. よくあるつまずき Q&A

**Q. `git push` で「Permission denied」**
→ 認証 정보が古い可能性。`Settings → Developer settings → Personal access tokens` で作り直し、
`git remote set-url origin https://<ID>:<トークン>@github.com/<ID>/force-download-guard.git` で設定し直します。

**Q. Releases に zip が現れない**
→ タグ push が届いていないか、CI が失敗しています。
リポジトリの **Actions** タブで赤い丸を**クリック** → 何で失敗したかを見ます。

**Q. ストアの審査で「権限が必要だ」と言われた**
→ 2-5 の「ホスト権限がなぜ必要か」の説明を、Description に加えて再提出します。

**Q. ローカルで試すたびに ID が変わってしまう**
→ 起きません。`manifest.json` の `key` で ID を固定しているため、
常に `pdndkdcaipoifeljbgbkekdeojbdkagh` です。
（`key` を消すと ID が変わるので **絶対に消さないでください**）

**Q. 「展開して読み込み」でエラーになる**
→ 解凍したフォルダの中の `manifest.json` ではなく、**フォルダそのもの**を指定します。`dist/` を丸ごと入れるのではなく、zip を展開してからフォルダを選びます。

**Q. zip を GitHub に push したのに Releases だけ zip が無い**
→ `dist/` は `.gitignore` に入れてあります（リポジトリを重くしないため）。
Releases は Actions が `tools/package.py` で自動生成するので **[.]gitignore のままで問題ありません**。

---

## 5. コマンド早見表

```bash
cd /home/user/force-download-guard      # 作業している拡張機能のフォルダ
cd /home/user/url-tool-39cf2075ec432800b501   # push するリポジトリ

python3 tools/build-html.py            # CSS → HTML 埋め込み
python3 tools/build-html.py --check    # 埋め込みが最新か確認
node tools/selftest.js                # 判定ロジック（46 テスト）
node tools/smoke-sites.js             # 管理ページ（9 テスト）
node tools/smoke-guard.js             # 操作検知（3 テスト）
python3 tools/package.py --out dist    # 配布 zip 作成
python3 tools/serve.py 8000            # ブラウザで見た目だけ確認（localhost:8000）

git add -A && git commit -m "..."      # 変更をコミット
git push origin main                  # GitHub へ
git tag v1.1.0 && git push origin v1.1.0   # Release 作成
```

---

## 6. この拡張機能の ID が固定されている理由

`manifest.json` の `key`（RSA 公開鍵）によって拡張機能 ID が固定されます。

```
chrome-extension://pdndkdcaipoifeljbgbkekdeojbdkagh/activate.html?url=https://example.com
```

この URL は **どの環境でも同じ** なので、ブックマークや、Web サイトのリンクとして配っても
各自の環境で開きます。ストア公開後も同じ ID が使われるため、
公開・非公開をまたいでも URL が壊れません。

> ⚠️ `manifest.json` の `key` を削除・変更すると ID が変わります。
> 変更する場合は `tools/extension_public_key.txt` も一緒に差し替えてください。
