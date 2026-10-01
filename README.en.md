# BookmarkDown

A local-first "poster wall" for your video bookmarks — Chrome extension (Manifest V3).

Right-click any video page to save it. Every bookmark is written into **plain Markdown files on your own disk**, with covers stored as WebP snapshots. Open the library in Obsidian, version it with git — no cloud, no database, no account.

[中文说明 →](README.md)

## Features (v0.1.0)

- **One-click capture**: right-click any page → "Save to BookmarkDown"; images and links work too
- **Metadata extraction**: deep support for Bilibili / YouTube (title, uploader, duration); generic Open Graph fallback everywhere else
- **Dual-channel covers**: in-page fetch first; visible-area screenshot as fallback; everything normalized to ≤640px WebP
- **Zero host_permissions**: no install-time permission warnings; access to the current tab is granted only via activeTab, only at the moment you capture
- **Poster wall**: left sidebar (Wall / Inbox / Collections / Settings), grid & list views, search, status filter, collections
- **Batch tools**: set author, move to collection, delete (with confirmation), click-to-cycle status (Want / Watching / Watched)
- **Detail card**: click an item for details; click the cover for fullscreen viewing (click anywhere / Esc to close)
- **Manual entry form**: for content you can't capture (in-app links, canvas, restricted pages) — paste a link and an image
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
- **Organize**: select items → batch author / move to collection / delete; click a card for the detail view; click the cover for fullscreen
- **Manual entry**: "+ Add item" (saves into the collection you are viewing)
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

- **v0.1.0 (current)**: capture, dual-channel covers, Markdown file library, poster wall, detail card, manual entry
- v0.2: in-library editing (title / tags / notes) + Markdown rendering, background re-fetch, popup quick search
- v0.3: Bilibili favorites import, dead-link detection, static HTML export
- v1.0: store release, multiple libraries, polish

## License

[AGPL-3.0](LICENSE) © 2026 RexKang
