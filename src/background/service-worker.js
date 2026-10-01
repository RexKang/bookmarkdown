// BookmarkDown · Service Worker（MV3）
// 右键菜单 → 页面抓取（MAIN 世界）→ 封面双通道 → 写入库目录 → badge 反馈。
// 权限模型：无 host_permissions；元数据与封面均借右键/图标的 activeTab 临时授权完成。

import { getRootHandle } from '../lib/idb.js';
import { saveCapture, isExcludedBySettings } from '../lib/fs.js';
import { grabPage } from '../content/page-grab.js';
import { fetchCoverInPage } from '../content/fetch-cover.js';

const EXCLUDED_PAGE_PREFIXES = [
  'chrome://', 'chrome-extension://', 'edge://', 'about:',
  'https://chrome.google.com/webstore', 'https://microsoftedge.microsoft.com/addons',
];

const MENUS = [
  { id: 'bd-page', title: '收藏到 BookmarkDown', contexts: ['page', 'video'] },
  { id: 'bd-image', title: '收藏图片到 BookmarkDown', contexts: ['image'] },
  { id: 'bd-link', title: '收藏链接到 BookmarkDown', contexts: ['link'] },
];

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    for (const menu of MENUS) chrome.contextMenus.create(menu);
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab?.id) return;
  collect(info, tab);
});

// popup「收藏当前页面」入口
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'collect-current') return;
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    if (!tab?.id) return sendResponse({ ok: false, error: '找不到当前页面' });
    collect({ menuItemId: 'bd-page', pageUrl: tab.url || '', srcUrl: null, linkUrl: null }, tab)
      .then(result => sendResponse(result))
      .catch(e => sendResponse({ ok: false, error: e.message || String(e) }));
  });
  return true;
});

async function collect(info, tab) {
  const pageUrl = info.pageUrl || info.linkUrl || tab.url || '';
  if (EXCLUDED_PAGE_PREFIXES.some(prefix => pageUrl.startsWith(prefix))) {
    await badge('×', '此页面不支持收藏');
    return { ok: false, error: '此页面不支持收藏' };
  }

  const root = await getRootHandle();
  if (!root) {
    await badge('!', '请先在库页选择收藏目录');
    return { ok: false, error: '尚未设置库目录：点扩展图标 →「打开库」→ 选择目录' };
  }
  try {
    if (await root.queryPermission({ mode: 'readwrite' }) !== 'granted') {
      await badge('!', '库目录需要授权：请打开库页点「解锁库」');
      return { ok: false, error: '库目录未授权：打开库页点「解锁库」' };
    }
  } catch (_) { /* 个别环境 queryPermission 异常时交给写盘报错 */ }

  if (await isExcludedBySettings(pageUrl, root).catch(() => false)) {
    await badge('×', '该页面在排除规则中');
    return { ok: false, error: '该页面在排除规则中（settings.json）' };
  }

  // ---- 元数据抓取（注入到页面主世界；activeTab 已随右键授予）----
  let meta = { title: tab.title || '', url: info.linkUrl || info.pageUrl || tab.url || '', og: {}, platform: 'generic' };
  try {
    const [res] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: 'MAIN',
      func: grabPage,
      args: [info.srcUrl || null, info.linkUrl || null],
    });
    if (res?.result) meta = { ...meta, ...res.result };
  } catch (e) {
    console.warn('[bookmarkdown] 元数据抓取失败（受限页面？）:', e.message);
  }

  // ---- 封面：通道一（页面内 fetch）→ 通道二（可见区截图）----
  const isImageCtx = info.menuItemId === 'bd-image' && info.srcUrl && !info.srcUrl.startsWith('blob:');
  const coverUrl = isImageCtx ? info.srcUrl : (meta.og?.image || meta.linkImg || null);
  let coverBlob = null;
  let coverSource = 'none';
  if (coverUrl) {
    try {
      const [res] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: fetchCoverInPage,
        args: [coverUrl],
      });
      const r = res?.result;
      if (r?.ok && r.b64) {
        coverBlob = b64ToBlob(r.b64, r.mime);
        coverSource = 'page-fetch';
      } else {
        coverSource = 'page-fetch-failed:' + (r?.err || 'no-result');
      }
    } catch (e) {
      coverSource = 'page-fetch-catch:' + (e.message || '').slice(0, 60);
    }
  }
  if (!coverBlob) {
    try {
      const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId);
      coverBlob = await (await fetch(dataUrl)).blob();
      coverSource = 'screenshot';
    } catch (e) {
      coverSource = 'screenshot-failed';
    }
  }

  // ---- 汇总并写盘 ----
  const record = {
    title: meta.og?.title || meta.title || hostnameOf(meta.url),
    url: meta.url || pageUrl,
    vid: meta.bili?.bvid || meta.yt?.videoId || null,
    platform: meta.platform || 'generic',
    author: meta.bili?.owner || meta.yt?.channel || null,
    duration: Number(meta.bili?.duration || meta.yt?.lengthSeconds) || null,
    coverBlob,
  };

  try {
    const result = await saveCapture(root, record);
    if (result.state === 'duplicate') {
      await badge('已存', '已在库中：' + record.title.slice(0, 36));
      return { ok: true, ...result, cover: coverSource };
    }
    await badge('✓', '已收藏：' + record.title.slice(0, 36));
    return { ok: true, ...result, cover: coverSource };
  } catch (e) {
    console.warn('[bookmarkdown] 写盘失败', e);
    await badge('!', '收藏失败：' + String(e.message || e).slice(0, 40));
    return { ok: false, error: e.message || String(e) };
  }
}

let badgeTimer = 0;
async function badge(text, title) {
  try {
    await chrome.action.setBadgeText({ text });
    if (title) await chrome.action.setTitle({ title });
    clearTimeout(badgeTimer);
    if (text) {
      badgeTimer = setTimeout(() => {
        chrome.action.setBadgeText({ text: '' }).catch(() => {});
        chrome.action.setTitle({ title: 'BookmarkDown' }).catch(() => {});
      }, 2200);
    }
  } catch (_) {}
}

function b64ToBlob(b64, mime) {
  const raw = atob(b64);
  const bytes = Uint8Array.from(raw, ch => ch.charCodeAt(0));
  return new Blob([bytes], { type: mime || 'image/webp' });
}

function hostnameOf(url) {
  try { return new URL(url).hostname; } catch { return '未命名收藏'; }
}
