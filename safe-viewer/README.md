# 安全ビューア

URL を貼るだけで、そのページの強制ダウンロードを Chrome の sandbox でブロックする単一 HTML。

公開 URL: https://ink3-1239.github.io/url-tool-39cf2075ec432800b501/safe-viewer/

- 外部 CSS/JS なし（1 ファイルで完結）
- iframe に `allow-downloads` を付けていないため、内部ページはファイルを保存できない
- https のサイトのみ表示可能（http は混合コンテンツでブロック）
