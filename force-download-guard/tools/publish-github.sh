#!/usr/bin/env bash
# =============================================================================
# publish-github.sh — 拡張機能を GitHub へ push する補助スクリプト
#
#   使い方:
#     bash tools/publish-github.sh [コミットメッセージ]
#
#   やること:
#     1. https://github.com/ink3-1239/url-tool-39cf2075ec432800b501 を clone
#     2. このフォルダ（拡張機能）を force-download-guard/ サブディレクトリへコピー
#     3. git add / commit
#     4. git push origin main
#
#   push の時に GitHub の認証（Personal Access Token）が求められます。
#
#   トークンを使う場合:
#     export GH_TOKEN=ghp_xxxxxxxxxxxxxxxx
#     bash tools/publish-github.sh
# =============================================================================
set -euo pipefail

REPO_URL="https://github.com/ink3-1239/url-tool-39cf2075ec432800b501.git"
REPO_NAME="url-tool-39cf2075ec432800b501"
SUB="force-download-guard"

SRC="$(cd "$(dirname "$0")/.." && pwd)"
WORK="/home/user/${REPO_NAME}"
MESSAGE="${1:-feat: 強制ダウンロード ガード (Chrome 拡張機能) を追加}"

echo "==> 作業フォルダ: $WORK"
echo "==> コピー元:     $SRC"

# --- 1. clone ---------------------------------------------------------------
if [ ! -d "$WORK/.git" ]; then
  echo "==> clone します: $REPO_URL"
  rm -rf "$WORK"
  git clone "$REPO_URL" "$WORK"
else
  echo "==> 既存の clone を使います"
  git -C "$WORK" pull --ff-only origin main || echo "   (pull に失敗したのでそのまま進めます)"
fi

# --- 2. サブディレクトリへコピー --------------------------------------------
echo "==> ${SUB}/ へコピーします"
rm -rf "${WORK:?}/${SUB}"
mkdir -p "${WORK}/${SUB}"
tar -C "$SRC" \
    --exclude='./.git' \
    --exclude='./.github' \
    --exclude='./dist' \
    --exclude='./__pycache__' \
    -cf - . | tar -C "${WORK}/${SUB}" -xf -

# --- 3. commit --------------------------------------------------------------
cd "$WORK"
git config user.name "ink3-1239"
git config user.email "ink3-1239@users.noreply.github.com"

git add "$SUB"
if git diff --cached --quiet; then
  echo "==> 変更がありません（push する内容がないため終了します）"
  exit 0
fi

echo "==> commit: $MESSAGE"
git commit -m "$MESSAGE"

echo "==> push します（GitHub の認証が必要になることがあります）"
if [ -n "${GH_TOKEN:-}" ]; then
  # Personal Access Token を使う（環境変数 GH_TOKEN に入れておきます）
  git push "https://ink3-1239:${GH_TOKEN}@github.com/${REPO_NAME}.git" main
else
  git push origin main
fi

echo
echo "==> 完了しました"
echo "    https://github.com/ink3-1239/url-tool-39cf2075ec432800b501/tree/main/${SUB}"
