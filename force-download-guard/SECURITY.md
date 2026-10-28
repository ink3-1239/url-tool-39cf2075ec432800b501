# Security Policy

## 対応バージョン

| Version | Supported |
| ------- | --------- |
| 1.0.x   | ✅        |

## 脆弱性の報告

**公開 Issue には脆弱性の内容を記載しないでください。**
GitHub の Security Advisory（Security タブ → Report a vulnerability） Outsourced 経由で
報告してください。報告後 7 日以内に対応可否をご連絡します。

## 隐私 / データ保護

- 本拡張機能は外部サーバーへ通信しません（テレメトリ・外部 API なし）。
- 設定とブロック履歴は `chrome.storage.local` にのみ保存されます。
- 「このセッションだけ」の保護対象は `chrome.storage.session` に保存され、
  ブラウザを閉じると破棄されます。
- ホスト権限は、ユーザーが「許可」したサイトに対してのみ要求・取得されます。
