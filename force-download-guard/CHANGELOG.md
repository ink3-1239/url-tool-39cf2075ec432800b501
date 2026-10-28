# Changelog

All notable changes to this project are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
- アイフレーム嵌入のテストページ（`tester.html`）と、ポップアップ内テスター
  偽の更新ページが自動で取得しようとすると、拡張機能が止める結果をその場で表示します
- CSS 埋め込みビルド（`tools/build-html.py`）と `--check` による同期チェック
- 公開ガイド（`PUBLISH.md`）: GitHub への push・Release 作成・Chrome ウェブストア公開の手順

### Changed
- ポップアップをシンプルなデザインに刷新（カードを 5 ブロックに整理、説明文を圧縮）
- CSS を各 HTML に埋め込み、HTML 1 ファイルだけダウンロードしても同じ見た目になるように
- ヘッダーのグラデーションを廃止し、全ページでフラットな配色に統一

### Fixed
- スクリプトが作出したクリック（`isTrusted=false`）をユーザー操作として数えていた問題を修正
- `activate.html` で URL を解析できなかった場合にエラー表示が出て止まる問題
  （`#explain` 要素の欠落による例外を修正）

## [1.0.0] - 2026-10-26

### Added
- 3 層の防御（content script / chrome.downloads / declarativeNetRequest）による強制ダウンロード遮断
- 保護対象スコープ: 拡張機能ページ（`chrome://` 等）＋ 拡張機能ストア
- 実行ファイル（`.exe` 等）と追加拡張（`.crx` / `.xpi`）はユーザー操作があっても遮断
- 「操作のない自動ダウンロード」の検出（pointerdown / click / Enter の操作検知）
- 偽の更新・警告ページ（日本語・英語・中国語・韓国語・スペイン語）の検出と警告バナー
- その場で有効化する 3 つの導線
  - ツールバーのポップアップ「このサイトで強制DLを止める」
  - アドレスバーに `guard` と入力して Enter
  - ブックマークレット（任意のページで 1 クリック）
- 拡張機能 ID の固定（manifest の `key`）による安定した URL
- 保護サイト管理ページ（`sites.html`）: 常時保護するサイトの登録・削除
- 信頼済みドメイン（例外）の一覧管理
- ブロック履歴の記録と通知
- 自動テスト（`tools/selftest.js` / `tools/smoke-sites.js`）とリリース用パッケージング
