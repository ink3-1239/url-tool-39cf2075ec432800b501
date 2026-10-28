#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""CSS を各 HTML へ埋め込むビルドスクリプト。

この拡張機能の HTML は「1 ファイルだけダウンロードしても同じ見た目」になるよう、
CSS を <style> タグの中へ埋め込んで自己完結させています。

CSS の正本はリポジトリ直下の *.css です。HTML を手で編集ときは
  /* FDG:CSS:BEGIN */ ... /* FDG:CSS:END */
のマーカー内だけを直してください（マーカー外に書いた CSS は
python3 tools/build-html.py 実行時に消えます）。

使い方:
    python3 tools/build-html.py          # HTML に CSS を埋め込む
    python3 tools/build-html.py --check  # 差分がないか検査のみ（CI 用）
"""
from __future__ import annotations

import io
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

BEGIN = "/* FDG:CSS:BEGIN */"
END = "/* FDG:CSS:END */"

# HTML ファイル → 埋め込む CSS ファイル（この順）
TARGETS = {
    "popup.html": ["popup.css"],
    "sites.html": ["sites.css"],
    "activate.html": ["sites.css"],
    "tester.html": ["sites.css", "tester.css"],
}


def read(path: str) -> str:
    with io.open(path, encoding="utf-8") as fh:
        return fh.read()


def write(path: str, text: str) -> None:
    with io.open(path, "w", encoding="utf-8") as fh:
        fh.write(text)


def build(css_files: list[str]) -> str:
    parts = []
    for name in css_files:
        body = read(os.path.join(ROOT, name)).strip()
        parts.append("/* --- %s --- */\n%s" % (name, body))
    return "\n\n".join(parts)


def replace_block(html: str, css: str) -> str:
    """<style> ... FDG:CSS:BEGIN/END ... </style> の内側を差し替える。"""
    start = html.find(BEGIN)
    if start < 0:
        raise SystemExit("マーカーが見つかりません: %s" % BEGIN)
    end = html.find(END)
    if end < 0:
        raise SystemExit("マーカーが見つかりません: %s" % END)
    head = html[: start + len(BEGIN)]
    tail = html[end:]
    return head + "\n" + css + "\n" + tail


def main() -> int:
    check_only = "--check" in sys.argv
    drifted = []

    for html_name, css_files in TARGETS.items():
        html_path = os.path.join(ROOT, html_name)
        html = read(html_path)
        css = build(css_files)

        if BEGIN not in html or END not in html:
            print("ERROR: %s に CSS マーカーがありません" % html_name)
            return 1

        current = html[html.find(BEGIN) + len(BEGIN) : html.find(END)].strip()
        if current == css.strip():
            print("  OK    %s" % html_name)
            continue

        if check_only:
            drifted.append(html_name)
            print("  DIFF  %s (CSS が未反映)" % html_name)
            continue

        write(html_path, replace_block(html, css))
        print("  BUILD %s <- %s" % (html_name, ", ".join(css_files)))

    if drifted:
        print("\nCSS が古い HTML: %s" % ", ".join(drifted))
        print("python3 tools/build-html.py を実行してください。")
        return 1

    print("\nすべての HTML に CSS が反映済みです。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
