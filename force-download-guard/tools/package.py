#!/usr/bin/env python3
"""
リリース用のパッケージ（zip）を作る。

  python3 tools/package.py [--out dist]

生成物: dist/force-download-guard-<version>.zip
拡張機能のルート（manifest.json が直下）になる構成で書き出す。
"""
import argparse
import json
import os
import subprocess
import sys
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# パッケージに含めないもの
EXCLUDE_DIRS = {'tools', '.github', 'dist', '.git', '__pycache__', 'node_modules', '.vscode', '.idea'}
EXCLUDE_FILES = {'.gitignore', '.DS_Store'}

INCLUDE = [
    'manifest.json', 'shared.js', 'background.js',
    'guard-isolated.js', 'guard-main.js',
    'popup.html', 'popup.js',
    'sites.html', 'sites.js',
    'activate.html', 'activate.js',
    'tester.html', 'tester.js',
    'README.md', 'README.en.md', 'PUBLISH.md', 'LICENSE', 'CHANGELOG.md', 'SECURITY.md',
]
# ※ *.css はパッケージに含めません。CSS は各 HTML に埋め込まれており、
#   HTML 1 ファイルだけダウンロードしても同じ見た目になるためです。


def collect():
    items = []
    for name in INCLUDE:
        path = os.path.join(ROOT, name)
        if os.path.isfile(path):
            items.append(name)
    for base, dirs, files in os.walk(os.path.join(ROOT, 'icons')):
        dirs[:] = [d for d in dirs if d not in EXCLUDE_DIRS]
        for f in files:
            p = os.path.join(base, f)
            items.append(os.path.relpath(p, ROOT))
    for base, dirs, files in os.walk(os.path.join(ROOT, 'tests')):
        dirs[:] = [d for d in dirs if d not in EXCLUDE_DIRS]
        for f in files:
            if f in EXCLUDE_FILES:
                continue
            p = os.path.join(base, f)
            items.append(os.path.relpath(p, ROOT))
    for base, dirs, files in os.walk(os.path.join(ROOT, '_locales')):
        dirs[:] = [d for d in dirs if d not in EXCLUDE_DIRS]
        for f in files:
            p = os.path.join(base, f)
            items.append(os.path.relpath(p, ROOT))
    return sorted(set(items))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default='dist', help='出力ディレクトリ')
    args = ap.parse_args()

    # CSS を各 HTML へ埋め込む（腐れ防止）
    build = os.path.join(ROOT, 'tools', 'build-html.py')
    if os.path.isfile(build):
        r = subprocess.run([sys.executable, build], cwd=ROOT)
        if r.returncode != 0:
            print('ERROR: CSS の埋め込みに失敗しました', file=sys.stderr)
            return r.returncode

    with open(os.path.join(ROOT, 'manifest.json'), encoding='utf-8') as f:
        version = json.load(f)['version']

    outdir = os.path.join(ROOT, args.out) if not os.path.isabs(args.out) else args.out
    os.makedirs(outdir, exist_ok=True)
    target = os.path.join(outdir, 'force-download-guard-%s.zip' % version)

    items = collect()
    with zipfile.ZipFile(target, 'w', zipfile.ZIP_DEFLATED) as z:
        for name in items:
            z.write(os.path.join(ROOT, name), name)

    print('created %s (%d files, %d bytes)' % (target, len(items), os.path.getsize(target)))


if __name__ == '__main__':
    sys.exit(main() or 0)
