# コントリビューション

お貢献ありがとうございます。

## 開発

```bash
git clone https://github.com/<owner>/force-download-guard.git
cd force-download-guard

# 構文チェックとテスト
for f in shared.js background.js guard-isolated.js guard-main.js popup.js sites.js activate.js tester.js; do node --check "$f"; done
node tools/selftest.js
node tools/smoke-sites.js
node tools/smoke-guard.js

# CSS を各 HTML へ埋め込む（styles を直したら必須）
python3 tools/build-html.py

# ローカルで開く
# → chrome://extensions → 開発者モード ON → 展開して読み込み → このフォルダ

# リリース用パッケージ（build-html.py を自動で実行します）
python3 tools/package.py
```

## CSS の扱い（重要）

各 HTML には CSS が埋め込まれています（HTML 1 ファイルだけダウンロードしても
同じ見た目になるためです）。CSS の正本は `popup.css` / `sites.css` / `tester.css` です。

- CSS を直すときは **CSS ファイルを編集**し、`python3 tools/build-html.py` を実行してください
- HTML の `/* FDG:CSS:BEGIN */`〜`/* FDG:CSS:END */` の内側を直接編集しても、
  次のビルドで上書きされます
- `python3 tools/build-html.py --check` で「埋め込みが最新か」を確認できます（CI でも実行）

## プルリクエストの前に

- `node tools/selftest.js` / `node tools/smoke-sites.js` / `node tools/smoke-guard.js` が通ることを確認してください
- `python3 tools/build-html.py --check` が通ることを確認してください
- 権限を追加する場合は、インストール時に表示される警告が変わるため `README.md` の権限表も更新してください
- 偽陽性（正規のダウンロードまで止める）を見つけた場合は、そのケースを `tools/selftest.js` に追加してください

## 方針

- 外部への通信（テレメトリ等）は追加しません
- ホスト権限はユーザー操作で許可されたサイトだけに限定します
