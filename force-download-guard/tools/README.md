# tools/

| ファイル | 用途 |
| --- | --- |
| `make-icons.py` | アイコン（16/48/128）を生成する（Pillow が必要） |
| `selftest.js` | 判定ロジックの自動テスト（`chrome` API をスタブして実行） |
| `smoke-sites.js` | 管理ページの起動テスト（最小 DOM スタブ） |
| `package.py` | リリース用 zip の生成（`dist/`） |
| `serve.py` | 拡張機能を入れずに管理ページを開くための配信サーバー |
| `extension_public_key.txt` | manifest の `key` に対応する公開鍵（拡張機能 ID 固定用・秘密鍵ではない） |

公開鍵から拡張機能 ID を求める場合:

```bash
python3 - <<'PY'
import base64, hashlib
der = base64.b64decode(open('tools/extension_public_key.txt').read().strip())
h = hashlib.sha256(der).hexdigest()[:32]
print(''.join(chr(ord('a') + int(c, 16)) for c in h))
PY
```
