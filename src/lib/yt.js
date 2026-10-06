// BookmarkDown · YouTube 导入数据层（运行时按站授权后可用）
// 路线：抓取播放列表页 HTML → 解析 ytInitialData（初始约 100 条）
//      → youtubei/v1/browse 续页（携带 continuation token）
// 注：列表项目前为 lockupViewModel 结构（旧 playlistVideoRenderer 已下线，解析兼容两层）

export const YT_ORIGINS = ['https://www.youtube.com/*', 'https://i.ytimg.com/*'];
const PAGE = 'https://www.youtube.com';
const THUMB = 'https://i.ytimg.com/vi/';
const KNOWN_WEB_KEY = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8'; // 公开网页端 key（页面提取失败时兜底）

// ---------------- 纯函数（可单测） ----------------

/** 从链接 / 裸 ID 提取播放列表 ID；识别不了返回 null */
export function ytPlaylistId(input) {
  if (!input) return null;
  const s = String(input).trim();
  try {
    const u = new URL(s);
    const list = u.searchParams.get('list');
    return list && /^[\w-]{2,80}$/.test(list) ? list : null;
  } catch (_) { /* 不是 URL，按裸 ID 试 */ }
  return /^[\w-]{2,80}$/.test(s) ? s : null;
}

/** 从 HTML 中标记符后提取首个 JSON 对象（括号配对扫描，字符串内括号安全） */
export function extractJsonAfter(html, marker) {
  const text = String(html);
  const i = text.indexOf(marker);
  if (i < 0) return null;
  const j = text.indexOf('{', i);
  if (j < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let k = j; k < text.length; k++) {
    const c = text[k];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) { try { return JSON.parse(text.slice(j, k + 1)); } catch (_) { return null; } }
    }
  }
  return null;
}

/** 播放列表页 HTML → { data, apiKey, clientVersion }；无数据返回 null */
export function extractYtPage(html) {
  const data = extractJsonAfter(html, 'ytInitialData');
  if (!data) return null;
  return {
    data,
    apiKey: (html.match(/"INNERTUBE_API_KEY":"([^"]+)"/) || [])[1] || null,
    clientVersion: (html.match(/"INNERTUBE_CONTEXT_CLIENT_VERSION":"([^"]+)"/) || [])[1] || null,
  };
}

/** "1:02:33" / "3:06" → 秒；解析不了返回 null */
export function parseYtDuration(text) {
  if (!text) return null;
  const t = String(text).trim();
  if (!/^\d{1,3}(?::\d{1,2}){1,2}$/.test(t)) return null;
  let s = 0;
  for (const p of t.split(':')) s = s * 60 + Number(p);
  return s;
}

function runsText(o) { return (o && o.runs ? o.runs : []).map(r => r.text || '').join(''); }

/** lockupViewModel → 条目；非视频返回 null */
export function parseLockup(vm) {
  if (!vm || vm.contentType !== 'LOCKUP_CONTENT_TYPE_VIDEO' || !vm.contentId) return null;
  const meta = (vm.metadata && vm.metadata.lockupMetadataViewModel) || {};
  const rows = (meta.metadata && meta.metadata.contentMetadataViewModel
    && meta.metadata.contentMetadataViewModel.metadataRows) || [];
  const author = (rows[0] && rows[0].metadataParts && rows[0].metadataParts[0]
    && rows[0].metadataParts[0].text && rows[0].metadataParts[0].text.content) || null;
  const badge = (vm.contentImage && vm.contentImage.thumbnailViewModel
    && vm.contentImage.thumbnailViewModel.overlays && vm.contentImage.thumbnailViewModel.overlays[0]
    && vm.contentImage.thumbnailViewModel.overlays[0].thumbnailBottomOverlayViewModel
    && vm.contentImage.thumbnailViewModel.overlays[0].thumbnailBottomOverlayViewModel.badges
    && vm.contentImage.thumbnailViewModel.overlays[0].thumbnailBottomOverlayViewModel.badges[0]
    && vm.contentImage.thumbnailViewModel.overlays[0].thumbnailBottomOverlayViewModel.badges[0].thumbnailBadgeViewModel
    && vm.contentImage.thumbnailViewModel.overlays[0].thumbnailBottomOverlayViewModel.badges[0].thumbnailBadgeViewModel.text) || null;
  return {
    videoId: vm.contentId,
    title: (meta.title && meta.title.content) || '',
    author,
    duration: parseYtDuration(badge),
    url: PAGE + '/watch?v=' + vm.contentId,
  };
}

/** 节点 → vmV  兼容两种形态：{lockupViewModel:{…}} 包裹 / 裸 vm 对象（续页响应为裸对象） */
function asLockup(n) {
  if (n && n.lockupViewModel) return n.lockupViewModel;
  if (n && n.contentId && typeof n.contentType === 'string' && n.contentType.indexOf('LOCKUP_CONTENT_TYPE_') === 0) return n;
  return null;
}

function contToken(vm) {
  return (vm && vm.continuationCommand && vm.continuationCommand.innertubeCommand
      && vm.continuationCommand.innertubeCommand.continuationCommand
      && vm.continuationCommand.innertubeCommand.continuationCommand.token)
    || (vm && vm.continuationCommand && vm.continuationCommand.token)
    || (vm && vm.continuationEndpoint && vm.continuationEndpoint.continuationCommand
      && vm.continuationEndpoint.continuationCommand.token)
    || null;
}

/** 播放列表页 ytInitialData → { title, channel, items, token } */
export function parsePlaylistData(data) {
  const out = { title: '', channel: '', items: [], token: null };
  const sb = (data && data.sidebar && data.sidebar.playlistSidebarRenderer
    && data.sidebar.playlistSidebarRenderer.items) || [];
  out.title = runsText(sb[0] && sb[0].playlistSidebarPrimaryInfoRenderer
    && sb[0].playlistSidebarPrimaryInfoRenderer.title);
  out.channel = runsText(sb[1] && sb[1].playlistSidebarSecondaryInfoRenderer
    && sb[1].playlistSidebarSecondaryInfoRenderer.videoOwner
    && sb[1].playlistSidebarSecondaryInfoRenderer.videoOwner.videoOwnerRenderer
    && sb[1].playlistSidebarSecondaryInfoRenderer.videoOwner.videoOwnerRenderer.title);

  const seen = new Set();
  const addVm = vm => { const it = parseLockup(vm); if (it && !seen.has(it.videoId)) { seen.add(it.videoId); out.items.push(it); } };

  const secs = (data && data.contents && data.contents.twoColumnBrowseResultsRenderer
    && data.contents.twoColumnBrowseResultsRenderer.tabs && data.contents.twoColumnBrowseResultsRenderer.tabs[0]
    && data.contents.twoColumnBrowseResultsRenderer.tabs[0].tabRenderer
    && data.contents.twoColumnBrowseResultsRenderer.tabs[0].tabRenderer.content
    && data.contents.twoColumnBrowseResultsRenderer.tabs[0].tabRenderer.content.sectionListRenderer
    && data.contents.twoColumnBrowseResultsRenderer.tabs[0].tabRenderer.content.sectionListRenderer.contents) || [];
  let list = null;
  for (const s of secs) if (s && s.itemSectionRenderer && s.itemSectionRenderer.contents && s.itemSectionRenderer.contents.length) { list = s.itemSectionRenderer.contents; break; }

  if (list) {
    for (const c of list) {
      const vm = asLockup(c);
      if (vm) addVm(vm);
      else if (c && c.continuationItemViewModel && !out.token) out.token = contToken(c.continuationItemViewModel);
    }
  } else {
    (function w(n) { // 布局兜底：全树收集
      if (Array.isArray(n)) { n.forEach(w); return; }
      if (!n || typeof n !== 'object') return;
      const vm = asLockup(n);
      if (vm) addVm(vm);
      if (n.continuationItemViewModel && !out.token) out.token = contToken(n.continuationItemViewModel);
      for (const v of Object.values(n)) w(v);
    })((data && data.contents) || data);
  }
  return out;
}

/** 续页响应 → { items, token } */
export function parseContinuationData(data) {
  const out = { items: [], token: null };
  const seen = new Set();
  const addVm = vm => { const it = parseLockup(vm); if (it && !seen.has(it.videoId)) { seen.add(it.videoId); out.items.push(it); } };
  (function w(n) {
    if (Array.isArray(n)) { n.forEach(w); return; }
    if (!n || typeof n !== 'object') return;
    const vm = asLockup(n);
    if (vm) addVm(vm);
    if (!out.token) {
      if (n.continuationItemViewModel) out.token = contToken(n.continuationItemViewModel);
      else if (n.continuationItemRenderer) out.token = contToken(n.continuationItemRenderer);
    }
    for (const v of Object.values(n)) w(v);
  })(data);
  return out;
}

/** 封面候选（maxres 缺失时 ytimg 返回 ~1KB 占位图，由调用方按大小过滤） */
export function ytThumbUrls(videoId) {
  return [THUMB + videoId + '/maxresdefault.jpg', THUMB + videoId + '/sddefault.jpg', THUMB + videoId + '/hqdefault.jpg'];
}

// ---------------- 抓取编排（注入 fetchFn 便于测试） ----------------

async function resText(r) { if (!r || !r.ok) throw new Error('HTTP ' + (r ? r.status : '?')); return r.text(); }
async function resJson(r) { if (!r || !r.ok) throw new Error('HTTP ' + (r ? r.status : '?')); return r.json(); }

/** 全量导入：抓页 → 初始批 → 续页（止于 cap / 无 token），返回 { playlistId, title, channel, items } */
export async function importYoutubePlaylist({ url, fetchFn = fetch, cap = 500, onProgress, contFetch } = {}) {
  const id = ytPlaylistId(url);
  if (!id) throw new Error('无法从链接中识别播放列表（示例：…/playlist?list=PLxxxx；稍后观看填 WL）');
  const html = await resText(await fetchFn(`${PAGE}/playlist?list=${encodeURIComponent(id)}`, { credentials: 'include' }));
  const page = extractYtPage(html);
  if (!page || !page.data) throw new Error('未读到列表数据：私密列表（如稍后观看）需先在本浏览器登录 YouTube');
  const parsed = parsePlaylistData(page.data);

  const items = []; const seen = new Set();
  const push = list => { for (const it of list) if (!seen.has(it.videoId)) { seen.add(it.videoId); items.push(it); } };
  push(parsed.items);
  if (onProgress) onProgress(items.length);

  let token = parsed.token, guard = 0;
  while (token && items.length < cap && guard < 100) {
    guard++;
    const body = JSON.stringify({
      context: { client: { clientName: 'WEB', clientVersion: page.clientVersion || '2.20261002.10.00', hl: 'en', gl: 'US' } },
      continuation: token,
    });
    let j;
    if (contFetch) {
      j = await contFetch({ apiKey: page.apiKey || KNOWN_WEB_KEY, clientVersion: page.clientVersion, token });
    } else {
      j = await resJson(await fetchFn(`${PAGE}/youtubei/v1/browse?key=${page.apiKey || KNOWN_WEB_KEY}&prettyPrint=false`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body,
      }));
    }
    const next = parseContinuationData(j);
    const before = items.length;
    push(next.items);
    token = next.token;
    if (onProgress) onProgress(items.length);
    if (!next.items.length || items.length === before) break; // 无新条目 / 重复令牌：止损
    await new Promise(r2 => setTimeout(r2, 150));
  }
  return { playlistId: id, title: parsed.title, channel: parsed.channel, items: items.slice(0, cap) };
}

/** 封面下载：maxresdefault → sddefault → hqdefault；ytimg 占位小图（<3KB）跳过 */
export async function fetchYtCover(videoId, fetchFn = fetch) {
  for (const u of ytThumbUrls(videoId)) {
    try {
      const r = await fetchFn(u, { credentials: 'omit' });
      if (!r || !r.ok) continue;
      const b = await r.blob();
      if (b && String(b.type).startsWith('image/') && b.size > 3000) return b;
    } catch (_) {}
  }
  return null;
}

// ---------------- 浏览器环境：YouTube 标签页续页器 ----------------
// 背景：扩展上下文对 youtubei 的 POST 会因 Origin=chrome-extension:// 被 YouTube 403；
// 唯一可行通道是在 youtube.com 页面的 MAIN world 中发起（同源请求，Origin 为页面自身）。
// 依赖：manifest permissions 含 "scripting"；运行时已授权 youtube.com 主机权限。

export async function makeYtTabPaginator({ url } = {}) {
  let tabId = null;
  let ready = false;
  const probe = async () => {
    const [r] = await chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', func: () => location.origin });
    return r && r.result;
  };
  const ensureReady = async () => {
    if (ready) return;
    const t = await chrome.tabs.create({ url: url || 'https://www.youtube.com/', active: false });
    tabId = t.id;
    const t0 = Date.now();
    while (Date.now() - t0 < 25000) {
      try { if ((await probe()) === 'https://www.youtube.com') { ready = true; return; } } catch (_) {}
      await new Promise(r2 => setTimeout(r2, 400));
    }
    throw new Error('YouTube 页面加载超时（检查网络/代理）');
  };
  return {
    /** 在页面上下文中请求续页；返回响应 JSON */
    async contFetch({ apiKey, clientVersion, token }) {
      await ensureReady();
      const [res] = await chrome.scripting.executeScript({
        target: { tabId },
        world: 'MAIN',
        func: async (k, cv, tk) => {
          try {
            const r = await fetch('https://www.youtube.com/youtubei/v1/browse?key=' + encodeURIComponent(k) + '&prettyPrint=false', {
              method: 'POST',
              credentials: 'include',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ context: { client: { clientName: 'WEB', clientVersion: cv, hl: 'en', gl: 'US' } }, continuation: tk }),
            });
            if (!r.ok) return { error: 'HTTP ' + r.status };
            return { data: await r.json() };
          } catch (e) { return { error: String((e && e.message) || e) }; }
        },
        args: [apiKey, clientVersion, token],
      });
      const v = res && res.result;
      if (!v) throw new Error('续页注入无结果');
      if (v.error) throw new Error('续页失败：' + v.error);
      return v.data;
    },
    async close() {
      if (tabId != null) { try { await chrome.tabs.remove(tabId); } catch (_) {} tabId = null; ready = false; }
    },
  };
}
