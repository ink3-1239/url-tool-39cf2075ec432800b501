# Force Download Guard

A Manifest V3 Chrome/Edge extension that stops **forced downloads** — the kind where a page
silently pushes a file (often a fake "update" or "your browser will close" installer) at you
without a real user action.

[日本語の README はこちら](./README.md)

---

## What it blocks

| Pattern | Example |
| --- | --- |
| Automatic download with no user action | `a.click()` after 3 s, `setTimeout(location.href = …)`, `meta refresh`, `form.submit()` |
| Executables | `.exe .msi .bat .cmd .scr .com .pif .hta .ps1 .vbs .jar .appimage .msix .apk .dmg .pkg .deb .rpm` |
| Extension bundles | `.crx .xpi` (a way to smuggle another extension in) |
| Fake warning / update pages | "Your browser will close", "Critical update", "ウイルス検出", "浏览器将关闭" … |

## How it works — three layers

1. **In-page suppression** (`guard-main.js`, MAIN world) — stops `a.click()`, `window.open()`,
   `location.href`, `form.submit()` and `meta refresh` from reaching a dangerous URL.
2. **Download decision** (`background.js`, `chrome.downloads`) — a download is blocked when the
   page is protected and there was **no genuine user action** in the last 2 s
   (pointerdown / click / Enter). Executables and extension bundles are blocked even with a
   user action.
3. **Network layer** (`declarativeNetRequest`) — dangerous URLs are blocked at the request level
   when the request originates from a protected page.

## Install

**From a release (recommended)**

1. Download `force-download-guard-<version>.zip` from the Releases page and unzip it.
2. Open `chrome://extensions` (`edge://extensions` on Edge).
3. Turn on **Developer mode**.
4. Click **Load unpacked** and select the unzipped folder.

**From source**

```bash
git clone https://github.com/<owner>/force-download-guard.git
# then "Load unpacked" → force-download-guard/
```

The extension ID is pinned (via the manifest `key`), so these URLs are always the same:

```
chrome-extension://pdndkdcaipoifeljbgbkekdeojbdkagh/popup.html
chrome-extension://pdndkdcaipoifeljbgbkekdeojbdkagh/sites.html
chrome-extension://pdndkdcaipoifeljbgbkekdeojbdkagh/activate.html
```

## Using it — activate on the site you are working on

The guard is meant to be switched on **from the site itself**, not through a registration form.

| You want to | Do this |
| --- | --- |
| Protect the site you are on right now | Click the toolbar icon → **このサイトで強制DLを止める** (or type `guard` in the address bar and press Enter) |
| Protect any page in one click | Drag the bookmarklet from the management page to your bookmarks bar |
| Protect a site permanently | Management page (`sites.html`) → paste the URL → **決定** |

Once activated, the page shows a small **🛡 保護中** badge and every forced download on that
site is blocked — until you close the browser (tick *keep* to make it permanent).

## Protected scope

* Extension pages: `chrome://`, `chrome-extension://`, `edge://`, …
* Extension stores: Chrome Web Store, Chrome for Android, AMO, Edge Add-ons, Opera Add-ons
* Any site you activate manually
* Optional **wide mode**: every site (asks for the `all_urls` permission)

## Privacy

* No network calls, no telemetry, no external API.
* Settings and the block log live in `chrome.storage.local` only.
* Session-only activations live in `chrome.storage.session` and are discarded when the browser
  closes.
* Host permissions are requested only for sites you explicitly allow.

## Development

```bash
node tools/selftest.js     # decision logic      → 45/45 passed
node tools/smoke-sites.js  # management page     → 9/9 passed
python3 tools/package.py   # build dist/…zip
python3 tools/serve.py 8000  # open sites.html without installing the extension
```

## GitHub Pages (optional)

The management page works standalone in a normal browser. Enable
**Settings → Pages → Source: `/` (root)** and open
`https://<owner>.github.io/<repo>/sites.html`.

## License

MIT — see [LICENSE](./LICENSE).
