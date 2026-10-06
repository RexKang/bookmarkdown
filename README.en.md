# BookmarkDown

A local-first "poster wall" for your video bookmarks — Chrome extension (Manifest V3).

Right-click any video page to save it. Every bookmark is written into **plain Markdown files on your own disk**, with covers stored as local image snapshots (WebP or originals). Open the library in Obsidian, version it with git — no cloud, no database, no account.

[中文说明 →](README.md)

## Features (v0.3.1)

- **One-click capture**: right-click any page → "Save to BookmarkDown"; images and links work too
- **Metadata extraction**: deep support for Bilibili / YouTube (title, uploader, duration); generic Open Graph fallback everywhere else
- **Dual-channel covers**: in-page fetch first; visible-area screenshot as fallback; originals kept as-is up to 1080P, larger ones scaled to 1920px long side (WebP q92) — quality first
- **Zero host_permissions**: no install-time permission warnings; access to the current tab is granted only via activeTab, only at the moment you capture
- **Poster wall**: left sidebar (Wall / Default / Collections / Settings), grid & list views, search, status filter, collections; light & dark themes
- **Private collections**: mark a collection private — its items stay out of the Wall; a lock icon marks it in the sidebar
- **Batch & edit**: "Batch manage" mode (delete / set author / copy to / move to); detail card → "Edit" for title / link / author / status / collection / tags / notes / cover
- **Tags & notes**: tag entries and write body notes; notes render as Markdown (GFM) in the detail card
- **Cover re-fetch**: one click on an old no-cover entry requests per-site permission and backfills the og title & cover (still zero install warnings)
- **Popup quick search**: search titles / authors / tags / URLs right from the toolbar icon; Enter opens the full wall
- **Side panel**: browse your library in a narrow column while watching
- **Keyboard nav**: `/` or Ctrl+K focuses search; arrows move the card focus; Enter opens details
- **Bilibili favorites import**: read your Bilibili favorite folders from the settings page and import them in bulk (covers fetched, deduped, titles cleaned)
- **Dead-link detection**: batch "Check links" marks 404/refused as broken and 403/rate-limited as uncertain; results are written back and badged
- **Static HTML export**: one click generates `wall.html` (with built-in search, private collections excluded by default) for browsing without the extension
- **Multiple libraries**: keep several library folders in Settings and switch with one click; "Add library" just adds it to the list (removing never touches files)
- **Collection hierarchy**: nest collections under a parent (indented in the sidebar); "Move level" in collection management; deleting a collection promotes its children
- **Detail card**: click an item for details; click the cover for fullscreen viewing (click anywhere / Esc to close)
- **Manual entry**: for content you can't capture (in-app links, canvas, restricted pages) — paste a link; cover via click / drag & drop / Ctrl+V anywhere
- **Deduplication**: the same video / URL is recognized; existing entries can be upgraded with a cover

## Library layout

Pick any folder as your library. **git init + occasional commits recommended** — that's your backup:

```
library/
├── index.md            # collection registry (including the default container)
├── 默认.md             # default container: new captures land here
├── 硬件.md             # each collection = one Markdown file
├── thumbnails/
│   └── BV1zmYP6aEdH.webp
└── settings.json       # exclusion rules
```

Each bookmark is a block inside a Markdown file: a hidden JSON metadata line plus a section body — friendly to Obsidian and git diffs:

```markdown
<!-- bookmarkdown-entry {"key":"vid:BV1zmYP6aEdH","title":"…","url":"https://www.bilibili.com/video/BV1zmYP6aEdH/","platform":"bilibili","author":"…","duration":713,"thumbnail":"thumbnails/BV1zmYP6aEdH.webp","status":"想看","collected":"2026-10-01 19:02"} -->
## (title)

- URL: https://www.bilibili.com/video/BV1zmYP6aEdH/
- 平台: bilibili
- 作者: …
- 时长: 713 秒
- 状态: 想看
- 收藏于: 2026-10-01 19:02

![cover](thumbnails/BV1zmYP6aEdH.webp)
<!-- /bookmarkdown-entry -->
```

## Install (dev build)

Not yet on the store; load it unpacked:

1. Clone / download this repository
2. Open `chrome://extensions` and enable "Developer mode"
3. Click "Load unpacked" and select the repository root (the folder containing `manifest.json`)
4. Click the extension icon → "Open Library" → pick a folder as your library

> After a browser restart, click "Unlock library" once on the library page; choose "Allow on every visit" in the prompt to avoid repeats.

Requires Chrome / Edge (Chromium) ≥ 122.

## Usage

- **Capture**: right-click → "Save to BookmarkDown"; a ✓ badge on the toolbar icon means success
- **Organize**: "Batch manage" → select items → delete / set author / copy to / move to; "Edit" changes all fields of one item; click the cover for fullscreen
- **Manual entry**: "+ Add" (saves into the collection you are viewing; covers accept Ctrl+V paste)
- **Re-fetch**: no-cover entries → detail card → "Re-fetch cover" → grant the site once → og title & cover backfilled
- **Shortcuts**: `/` search · `Esc` clear/close · arrows move card focus · `Enter` opens details
- **Bilibili import**: Settings → "Read my favorites" → pick a folder → "Import" (requires a Bilibili login; creates a "B站·…" collection)
- **Dead links**: Batch manage → select items → "Check links"; a red badge means broken
- **Export**: Settings → "Export wall.html" → open `wall.html` from your library folder
- **Libraries**: Settings → "Libraries" row, click a name to switch; "Add library" appends a folder
- **Hierarchy**: Collections → select → "Move level ▾" → nest under a parent / move to top
- **Exclusions**: edit `settings.json` inside your library

## Development & tests

No build step, no runtime dependencies — the source is the artifact (native ES modules):

```bash
node test/md.test.mjs   # text layer: entry/collection parsing, upsert & remove
node test/fs.test.mjs   # storage layer: init, dedupe, target-collection writes (in-memory fake dir)
```

## Privacy

- Data is written only to the folder you pick; nothing is uploaded, no telemetry, no accounts
- No host_permissions: the extension touches the current tab via activeTab only, only when you invoke it
- Cover fetching happens inside the page context — no third-party services involved

## Roadmap

- **v0.3.1 (current)**: subfolders (collection hierarchy), multiple libraries
- v0.4.0 (planned): YouTube playlist import (Watch Later / Liked; page-data parsing + per-site permission)
- **v0.3.0**: Bilibili favorites import, dead-link detection, static HTML export
- **v0.2.0**: tags / notes + Markdown rendering, cover re-fetch, popup quick search, side panel, keyboard nav
- **v0.1.1**: edit dialog, batch manage mode, light/dark themes, private collections, cover quality upgrade (originals up to 1080P kept), Ctrl+V paste anywhere
- **v0.1.0**: capture, dual-channel covers, Markdown file library, poster wall, detail card, manual entry
- v1.0: store release, polish

## License

[AGPL-3.0](LICENSE) © 2026 RexKang
