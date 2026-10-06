// BookmarkDown · 库页主界面
// 左栏（墙 / 合集 / 设置 + 合集列表）+ 网格/列表双视图 + 合集页 + 轻编辑。
// 设计定稿：docs/0.2.0-PRD.md §2.1.5 / §7；设计稿 spike/style-drafts/。

import { getRootHandle, setRootHandle, idbGet, idbSet,
  getActiveRoot, getLibraries, upsertLibrary, setActiveLibrary, removeLibrary } from '../lib/idb.js';
import { YT_ORIGINS, importYoutubePlaylist, fetchYtCover, makeYtTabPaginator } from '../lib/yt.js';
import {
  ensureLibrary, listCollectionFiles, readTextFile, writeFile,
  readIndexTopics, INDEX_FILE, INBOX_ID, saveCapture, processCover, THUMB_DIR,
} from '../lib/fs.js';
import { safeStem, nowStamp } from '../lib/util.js';
import { renderNote } from '../lib/mdrender.js';
import { buildWallHtml } from '../lib/export-wall.js';
import { fetchNav, wbiKeysFromNav, fetchFolders, fetchFolderPage } from '../lib/bili.js';
import {
  parseEntries, renderEntry, replaceEntry, removeEntry, appendEntry,
  extractNote, upsertTopic, removeTopic, updateTopic,
} from '../lib/md.js';

const $ = id => document.getElementById(id);

// ---------------- 主题（浅色 / 深色）与版本号 ----------------
const THEME_KEY = 'bd-theme';
function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem(THEME_KEY, t); } catch (_) {}
  const b = $('btnTheme');
  if (b) {
    b.textContent = t === 'light' ? '🌙' : '☀️';
    b.title = t === 'light' ? '切换为深色' : '切换为浅色';
  }
}
(function initTheme() {
  let t = 'dark';
  try { t = localStorage.getItem(THEME_KEY) || 'dark'; } catch (_) {}
  applyTheme(t);
})();
$('btnTheme').addEventListener('click', () => {
  applyTheme(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light');
});
$('verLink').textContent = 'v' + chrome.runtime.getManifest().version;

const PLATFORM_LABEL = { bilibili: 'B站', youtube: 'YouTube', web: '网页', generic: '网页' };
const STATUS_CYCLE = ['想看', '在看', '看过'];
const STATUS_CLASS = { '想看': 'st-want', '在看': 'st-ing', '看过': 'st-done' };
const STATUS_DOT = { '想看': 'd-want', '在看': 'd-ing', '看过': 'd-done' };

const state = {
  root: null,
  files: [],          // [{ file, title }]
  entries: [],        // [{ file, fileTitle, key, meta }]
  inboxFile: '默认.md',
  view: 'wall',       // wall | collections | settings
  mode: 'grid',       // grid | list
  batch: false,       // 批次管理模式（勾选框只在此时出现）
  transferMode: 'move', // 复制至 / 移动至
  collection: null,   // null = 全部；否则合集文件名
  search: '',
  statusFilter: '',
  tagFilter: '',
  selEntries: new Set(),  // 条目 key
  selColls: new Set(),    // 合集文件名
};

const coverUrls = new Map(); // 封面相对路径 → objectURL

const escapeHtml = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const fmtDuration = s => {
  s = Number(s) || 0;
  if (!s) return '';
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return (h ? h + ':' + String(m).padStart(2, '0') : String(m)) + ':' + String(sec).padStart(2, '0');
};

// ---------------- 基础 UI ----------------
function showScreen(which) {
  $('screen-onboard').hidden = which !== 'onboard';
  $('screen-locked').hidden = which !== 'locked';
  $('app').hidden = which !== 'app';
}

function toast(text) {
  const el = $('toast');
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.hidden = true; }, 2200);
}

function confirmBox({ title, text, okText = '删除', onOk }) {
  $('modalTitle').textContent = title;
  $('modalText').textContent = text;
  const okBtn = $('modalOk');
  okBtn.textContent = okText;
  $('modal').hidden = false;
  okBtn.onclick = async () => {
    $('modal').hidden = true;
    await onOk();
  };
}
$('modalCancel').addEventListener('click', () => { $('modal').hidden = true; });

function hideForms() {
  for (const id of ['authorForm', 'collForm', 'newCollForm', 'hierForm']) $(id).hidden = true;
}

// ---------------- 数据 ----------------
async function coverUrl(relPath) {
  if (!relPath) return null;
  if (coverUrls.has(relPath)) return coverUrls.get(relPath);
  let url = null;
  try {
    const parts = relPath.split('/');
    let dir = state.root;
    for (const p of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(p);
    const fh = await dir.getFileHandle(parts.at(-1));
    url = URL.createObjectURL(await fh.getFile());
  } catch (_) { url = null; }
  coverUrls.set(relPath, url);
  return url;
}

function fillCovers(scope) {
  scope.querySelectorAll('img[data-cover]').forEach(async img => {
    const url = await coverUrl(img.dataset.cover);
    if (url) img.src = url;
  });
}

function invalidate(file) {
  return idbSet('entries', 'file:' + file, { lastModified: -1, rows: [] });
}

async function loadAll() {
  state.files = await listCollectionFiles(state.root);
  state.inboxFile = (await readIndexTopics(state.root)).find(t => t.id === INBOX_ID)?.file || state.inboxFile;
  const all = [];
  for (const f of state.files) {
    let rows = [];
    try {
      const file = await (await state.root.getFileHandle(f.file)).getFile();
      const cached = await idbGet('entries', 'file:' + f.file);
      if (cached && cached.lastModified === file.lastModified) {
        rows = cached.rows;
      } else {
        rows = parseEntries(await file.text()).map(e => ({ key: e.key, meta: e.meta }));
        await idbSet('entries', 'file:' + f.file, { lastModified: file.lastModified, rows });
      }
    } catch (e) { console.warn('[bookmarkdown] 读取合集失败：', f.file, e); rows = []; }
    for (const r of rows) all.push({ file: f.file, fileTitle: f.title, key: r.key, meta: r.meta });
  }
  state.entries = all;
  const validKeys = new Set(all.map(e => e.key));
  for (const k of [...state.selEntries]) if (!validKeys.has(k)) state.selEntries.delete(k);
  const validFiles = new Set(state.files.map(f => f.file));
  for (const f of [...state.selColls]) if (!validFiles.has(f)) state.selColls.delete(f);
}

async function reloadData() {
  await loadAll();
  renderAll();
}

// ---------------- 过滤 ----------------
function collectionTitle(file) {
  return state.files.find(f => f.file === file)?.title || file.replace(/\.md$/i, '');
}

/** 是否私密合集（墙视图不展示其条目） */
function isPrivateFile(file) {
  return state.files.some(f => f.file === file && f.private === true);
}

function visibleEntries() {
  let list = state.entries.slice();
  if (state.collection) list = list.filter(e => e.file === state.collection);
  else list = list.filter(e => !isPrivateFile(e.file)); // 私密合集不在「墙」展示
  if (state.statusFilter) list = list.filter(e => (e.meta.status || '想看') === state.statusFilter);
  if (state.tagFilter) list = list.filter(e => (e.meta.tags || []).includes(state.tagFilter));
  const q = state.search.trim().toLowerCase();
  if (q) {
    list = list.filter(e =>
      [e.meta.title, e.meta.author, e.meta.url, e.fileTitle].filter(Boolean).join(' ').toLowerCase().includes(q));
  }
  list.sort((a, b) => String(b.meta.collected || '').localeCompare(String(a.meta.collected || '')));
  return list;
}

// ---------------- 渲染 ----------------
function renderAll() {
  renderSidebar();
  renderTopbar();
  renderOpbar();
  renderContent();
}

function renderSidebar() {
  const counts = new Map();
  for (const e of state.entries) counts.set(e.file, (counts.get(e.file) || 0) + 1);
  const colls = collectionFiles();
  const topIds = new Set(colls.filter(f => !f.parent).map(f => f.id));
  const itemHtml = (f, child) =>
    `<div class="subitem${child ? ' child' : ''}${state.view === 'wall' && state.collection === f.file ? ' on' : ''}" data-file="${escapeHtml(f.file)}">` +
    `<span>${f.private ? '<span class="lock">🔒</span>' : ''}${escapeHtml(f.title)}</span><b>${counts.get(f.file) || 0}</b></div>`;
  const tops = colls.filter(f => !f.parent);
  const orphans = colls.filter(f => f.parent && !topIds.has(f.parent));
  $('collist').innerHTML = tops.map(f =>
    itemHtml(f, false) + colls.filter(k => f.id && k.parent === f.id).map(k => itemHtml(k, true)).join('')
  ).join('') + orphans.map(f => itemHtml(f, false)).join('');
  $('collist').querySelectorAll('.subitem').forEach(el => el.addEventListener('click', () => {
    state.view = 'wall';
    state.collection = el.dataset.file;
    state.batch = false;
    state.selEntries.clear();
    renderAll();
  }));
  $('navWall').classList.toggle('on', state.view === 'wall' && state.collection === null);
  $('navInbox').classList.toggle('on', state.view === 'wall' && state.collection === state.inboxFile);
  $('inboxCount').textContent = counts.get(state.inboxFile) || 0;
  $('navColl').classList.toggle('on', state.view === 'collections');
  $('navSet').classList.toggle('on', state.view === 'settings');
  $('sideinfo').textContent = '库：' + state.root.name;
}

/** 合集文件（不含「默认」容器） */
function collectionFiles() {
  return state.files.filter(f => f.file !== state.inboxFile);
}

function renderTopbar() {
  const tags = new Set();
  for (const e of state.entries) (e.meta.tags || []).forEach(t => tags.add(t));
  $('fTag').innerHTML = '<option value="">标签：全部</option>' + [...tags].map(t =>
    `<option value="${escapeHtml(t)}"${t === state.tagFilter ? ' selected' : ''}>${escapeHtml(t)}</option>`).join('');
  $('fStatus').value = state.statusFilter;
  $('segView').querySelectorAll('span').forEach(sp =>
    sp.classList.toggle('on', sp.dataset.mode === state.mode));
}

function refreshCollPrivacyBtn() {
  const files = [...state.selColls];
  const allPrivate = files.length > 0 && files.every(f => isPrivateFile(f));
  $('btnPrivacy').textContent = allPrivate ? '取消私密' : '设置为私密';
  $('btnPrivacy').disabled = files.length === 0;
}

function refreshSelUI() {
  const n = state.selEntries.size;
  $('selInfo').textContent = '已选 ' + n + ' 条';
  for (const id of ['btnDelEntry', 'btnAuthor', 'btnCopyTo', 'btnMoveTo', 'btnCheck']) $(id).disabled = n === 0;
}

function toggleEntrySelection(key) {
  if (state.selEntries.has(key)) state.selEntries.delete(key); else state.selEntries.add(key);
  const on = state.selEntries.has(key);
  [...document.querySelectorAll('.enpick')].filter(i => i.dataset.key === key).forEach(i => { i.checked = on; });
  refreshSelUI();
}

function renderOpbar() {
  const isWall = state.view === 'wall';
  const isColl = state.view === 'collections';
  const batch = isWall && state.batch;
  document.body.classList.toggle('batch', batch);
  $('btnAdd').hidden = !isWall || batch;
  $('btnBatch').hidden = !isWall || batch;
  $('btnBatchBack').hidden = !batch;
  $('btnDelEntry').hidden = !batch;
  $('btnAuthor').hidden = !batch;
  $('btnCopyTo').hidden = !batch;
  $('btnMoveTo').hidden = !batch;
  $('btnCheck').hidden = !batch;
  $('btnNewColl').hidden = !isColl;
  $('btnDelColl').hidden = !isColl;
  $('btnPrivacy').hidden = !isColl;
  $('btnHier').hidden = !isColl;
  $('selInfo').hidden = state.view === 'settings' || (isWall && !batch);
  if (isColl) {
    $('selInfo').textContent = '已选 ' + state.selColls.size + ' 个';
    $('btnDelColl').disabled = state.selColls.size === 0;
    $('btnHier').disabled = state.selColls.size === 0;
    refreshCollPrivacyBtn();
  } else if (batch) {
    refreshSelUI();
  }
  if (!isWall && !isColl) hideForms();
}

function renderContent() {
  const c = $('content');
  if (state.view === 'wall') renderWall(c);
  else if (state.view === 'collections') renderCollections(c);
  else renderSettings(c);

  if (state.view === 'wall') {
    $('vtName').textContent = state.collection ? collectionTitle(state.collection) : '全部条目';
    $('vtCount').textContent = visibleEntries().length + ' 条';
  } else if (state.view === 'collections') {
    $('vtName').textContent = '合集';
    $('vtCount').textContent = collectionFiles().length + ' 个';
  } else {
    $('vtName').textContent = '设置';
    $('vtCount').textContent = '';
  }
  $('ftCount').textContent = '共 ' + state.entries.length + ' 条';
  $('ftColls').textContent = '合集 ' + collectionFiles().length + ' 个';
  $('ftLib').textContent = '库：' + state.root.name;
}

function renderWall(c) {
  const list = visibleEntries();
  if (!list.length) {
    const hint = !state.collection
      ? '还没有收藏——在任意网页右键「收藏到 BookmarkDown」，或点上方「＋ 添加收藏」手动补录。'
      : state.collection === state.inboxFile
        ? '「默认」里还没有条目——新收藏会先落到这里；也可以用「＋ 添加收藏」手动补录。'
        : '该合集还没有条目——进入「默认」或其他合集，用「批量管理 → 移动至」挪进来。';
    c.innerHTML = '<div class="emptyhint">' + hint + '</div>';
    return;
  }
  c.innerHTML = state.mode === 'grid' ? gridHtml(list) : listHtml(list);
  bindWallEvents(c);
  fillCovers(c);
}

function gridHtml(list) {
  return '<div class="wall">' + list.map(e => {
    const m = e.meta;
    const meta = [PLATFORM_LABEL[m.platform] || m.platform, m.author, fmtDuration(m.duration)]
      .filter(Boolean).join(' · ');
    const status = m.status || '想看';
    return `
 <article class="card" data-key="${escapeHtml(e.key)}">
  <div class="thumb">
   <label class="pick"><input type="checkbox" class="enpick" data-key="${escapeHtml(e.key)}" ${state.selEntries.has(e.key) ? 'checked' : ''}></label>
   ${m.thumbnail
      ? `<img data-cover="${escapeHtml(m.thumbnail)}" alt="">`
      : `<div class="grad" style="background:linear-gradient(135deg,#1d2433,#131722)">${escapeHtml(PLATFORM_LABEL[m.platform] || '')}</div>`}
   <span class="badge coll">${escapeHtml(e.fileTitle)}</span>
   ${m.linkState === 'dead' ? '<span class="badge lbad">已失效</span>' : m.linkState === 'unknown' ? '<span class="badge lbad unk">存疑</span>' : ''}
  </div>
  <div class="ctitle">${escapeHtml(m.title || m.url)}</div>
  <div class="cmeta"><span class="stc" data-stkey="${escapeHtml(e.key)}"><span class="dot ${STATUS_DOT[status]}"></span>${status}</span><span>·</span><span style="overflow:hidden;text-overflow:ellipsis">${escapeHtml(meta)}</span></div>
 </article>`;
  }).join('') + '</div>';
}

function listHtml(list) {
  return `
<table class="recs"><thead><tr>
 <th class="chk"><input type="checkbox" id="chkAll"></th><th>封面</th><th>名称</th><th>平台</th><th>合集</th><th>状态</th><th>收藏时间</th><th>URL</th>
</tr></thead><tbody>` + list.map(e => {
    const m = e.meta;
    const status = m.status || '想看';
    return `
 <tr data-key="${escapeHtml(e.key)}">
  <td class="chk"><input type="checkbox" class="enpick" data-key="${escapeHtml(e.key)}" ${state.selEntries.has(e.key) ? 'checked' : ''}></td>
  <td>${m.thumbnail
      ? `<img class="mini" data-cover="${escapeHtml(m.thumbnail)}" alt="">`
      : '<span class="nomark">无图</span>'}</td>
  <td><div class="rname">${escapeHtml(m.title || m.url)}${m.linkState === 'dead' ? ' <span class="lbadgeList">已失效</span>' : m.linkState === 'unknown' ? ' <span class="lbadgeList unk">存疑</span>' : ''}</div><div class="rsub">${escapeHtml([m.author, fmtDuration(m.duration)].filter(Boolean).join(' · '))}</div></td>
  <td><span class="plat">${escapeHtml(PLATFORM_LABEL[m.platform] || m.platform || '')}</span></td>
  <td><span class="colltag">${escapeHtml(e.fileTitle)}</span></td>
  <td><span class="${STATUS_CLASS[status]} stclick" data-stkey="${escapeHtml(e.key)}">${status}</span></td>
  <td class="rtime">${escapeHtml(m.collected || '')}</td>
  <td><span class="url">${escapeHtml(m.url || '')}</span></td>
 </tr>`;
  }).join('') + '</tbody></table>';
}

function bindWallEvents(c) {
  c.querySelectorAll('.card').forEach(card => card.addEventListener('click', ev => {
    if (ev.target.closest('.pick') || ev.target.closest('[data-stkey]')) return;
    const entry = state.entries.find(x => x.key === card.dataset.key);
    if (!entry) return;
    if (state.batch) toggleEntrySelection(entry.key); else openDetail(entry);
  }));
  c.querySelectorAll('tr[data-key]').forEach(tr => tr.addEventListener('click', ev => {
    if (ev.target.closest('.chk') || ev.target.closest('[data-stkey]')) return;
    const entry = state.entries.find(x => x.key === tr.dataset.key);
    if (!entry) return;
    if (state.batch) toggleEntrySelection(entry.key); else openDetail(entry);
  }));
  c.querySelectorAll('.enpick').forEach(el => el.addEventListener('change', () => {
    el.checked ? state.selEntries.add(el.dataset.key) : state.selEntries.delete(el.dataset.key);
    refreshSelUI();
  }));
  c.querySelectorAll('[data-stkey]').forEach(el => el.addEventListener('click', async () => {
    const entry = state.entries.find(x => x.key === el.dataset.stkey);
    if (!entry) return;
    const cur = entry.meta.status || '想看';
    const next = STATUS_CYCLE[(STATUS_CYCLE.indexOf(cur) + 1) % STATUS_CYCLE.length];
    await setStatus(entry, next);
  }));
  const all = c.querySelector('#chkAll');
  if (all) all.addEventListener('change', () => {
    c.querySelectorAll('.enpick').forEach(el => {
      el.checked = all.checked;
      all.checked ? state.selEntries.add(el.dataset.key) : state.selEntries.delete(el.dataset.key);
    });
    renderOpbar();
  });
}

function renderCollections(c) {
  const countOf = f => state.entries.filter(e => e.file === f).length;
  const firstCover = f => state.entries.find(e => e.file === f && e.meta.thumbnail)?.meta.thumbnail || null;
  c.innerHTML = '<div class="cgrid">' + collectionFiles().map(f => `
 <div class="ccard" data-file="${escapeHtml(f.file)}">
  <div class="ccover">
   <label class="pick"><input type="checkbox" class="collpick" data-file="${escapeHtml(f.file)}" ${state.selColls.has(f.file) ? 'checked' : ''}></label>
   ${firstCover(f.file)
      ? `<img data-cover="${escapeHtml(firstCover(f.file))}" alt="">`
      : `<div class="grad" style="background:linear-gradient(135deg,#1d2433,#131722)">${escapeHtml(f.title.slice(0, 4))}</div>`}
   <span class="cnt">${countOf(f.file)} 条</span>
  </div>
  <div class="cbody">
   <div class="cname">${f.parent ? '<span class="childmark">↳</span>' : ''}${f.private ? '<span class="lock">🔒</span>' : ''}${escapeHtml(f.title)}</div>
   <div class="cmeta2">${f.parent ? '子合集 · 隶属于 ' + escapeHtml((state.files.find(x => x.id === f.parent) || {}).title || '？') : escapeHtml(f.file)}</div>
  </div>
 </div>`).join('') + '<div class="ccard newcard" id="newCard">＋ 新建合集</div></div>';

  // 点封面图片即勾选（不用对准小勾选框）
  c.querySelectorAll('.ccover').forEach(cv => cv.addEventListener('click', ev => {
    if (ev.target.closest('.pick')) return;
    const card = cv.closest('.ccard');
    if (!card.dataset.file) return;
    const f = card.dataset.file;
    state.selColls.has(f) ? state.selColls.delete(f) : state.selColls.add(f);
    renderContent();
    renderOpbar();
  }));
  c.querySelectorAll('.collpick').forEach(el => el.addEventListener('change', () => {
    el.checked ? state.selColls.add(el.dataset.file) : state.selColls.delete(el.dataset.file);
    renderOpbar();
  }));
  c.querySelector('#newCard').addEventListener('click', openNewCollForm);
  fillCovers(c);
}

function linkStateText(m) {
  if (!m.checked && !m.linkState) return '';
  const when = m.checked ? '（' + m.checked + '）' : '';
  if (m.linkState === 'dead') return '已失效' + when;
  if (m.linkState === 'unknown') return '存疑：403 / 限流，未必失效' + when;
  return '正常' + when;
}

async function probeUrl(url) {
  try {
    const resp = await fetch(url, { method: 'GET', credentials: 'omit', cache: 'no-store',
      signal: AbortSignal.timeout(12000) });
    try { if (resp.body) await resp.body.cancel(); } catch (_) {}
    if (resp.status === 404 || resp.status === 410) return 'dead';
    if (resp.status >= 400) return [403, 405, 429].includes(resp.status) ? 'unknown' : 'dead';
    return 'ok';
  } catch (_) {
    return 'dead';
  }
}

async function checkLinks() {
  const targets = state.entries.filter(e => state.selEntries.has(e.key) && /^https?:/i.test(e.meta.url || ''));
  if (!targets.length) { toast('选中的条目没有可检测的链接'); return; }
  const origins = [...new Set(targets.map(e => { try { return new URL(e.meta.url).origin + '/*'; } catch (_) { return null; } }).filter(Boolean))];
  try {
    const missing = [];
    for (const o of origins) {
      if (!(await chrome.permissions.contains({ origins: [o] }))) missing.push(o);
    }
    if (missing.length) {
      const granted = await chrome.permissions.request({ origins: missing.slice(0, 25) }).catch(() => false);
      if (!granted) { toast('未获得站点权限，无法检测'); return; }
    }
  } catch (_) { /* API 不可用时直接尝试（受 CORS 约束） */ }
  const btn = $('btnCheck');
  const oldText = btn.textContent;
  btn.disabled = true;
  const results = [];
  let done = 0;
  const runOne = async () => {
    while (true) {
      const e = targets.shift();
      if (!e) return;
      results.push({ key: e.key, file: e.file, state: await probeUrl(e.meta.url) });
      done++;
      btn.textContent = '检测中… ' + done + '/' + (done + targets.length);
    }
  };
  try {
    const workers = Array.from({ length: Math.min(4, targets.length) }, runOne);
    await Promise.all(workers);
    const now = nowStamp();
    const byFile = new Map();
    for (const r of results) {
      if (!byFile.has(r.file)) byFile.set(r.file, []);
      byFile.get(r.file).push(r);
    }
    for (const [file, list] of byFile) {
      let text = await readTextFile(state.root, file);
      if (text === null) continue;
      for (const r of list) {
        const fresh = parseEntries(text).find(x => x.key === r.key);
        if (!fresh) continue;
        const meta = { ...fresh.meta, checked: now };
        if (r.state === 'dead') meta.linkState = 'dead';
        else if (r.state === 'unknown') meta.linkState = 'unknown';
        else delete meta.linkState;
        const { text: updated } = replaceEntry(text, r.key, renderEntry(meta, extractNote(fresh.body)));
        text = updated;
      }
      await writeFile(state.root, file, text);
    }
    let okN = 0, deadN = 0, unkN = 0;
    for (const r of results) {
      if (r.state === 'ok') okN++;
      else if (r.state === 'dead') deadN++;
      else unkN++;
    }
    await reloadData();
    renderAll();
    toast('检测完成：正常 ' + okN + ' · 失效 ' + deadN + (unkN ? ' · 存疑 ' + unkN : ''));
  } catch (err) {
    toast('检测失败：' + String(err.message || err).slice(0, 50));
  }
  btn.disabled = false;
  btn.textContent = oldText;
}

// ---------------- B 站收藏夹导入 ----------------
let biliCtx = null;
let biliFolders = [];

async function ensureBiliPerm() {
  const origins = ['https://api.bilibili.com/*', 'https://*.hdslb.com/*'];
  try {
    const missing = [];
    for (const o of origins) {
      if (!(await chrome.permissions.contains({ origins: [o] }))) missing.push(o);
    }
    if (missing.length) return !!(await chrome.permissions.request({ origins: missing }).catch(() => false));
  } catch (_) { return true; }
  return true;
}

async function fillLibRow() {
  const el = $('libRow');
  if (!el) return;
  const libs = await getLibraries().catch(() => null);
  if (!libs || !Array.isArray(libs.list) || !libs.list.length) { el.innerHTML = '多库：<span class="hint">仅当前库</span>'; return; }
  el.innerHTML = '多库：' + libs.list.map(l =>
    `<span style="display:inline-block;margin:2px 0"><button class="secondary libbtn" data-id="${l.id}" ${l.id === libs.activeId ? 'disabled' : ''}>${escapeHtml(l.name)}${l.id === libs.activeId ? ' ✓' : ''}</button>` +
    `<a href="#" class="librm" data-id="${l.id}" title="从列表移除（磁盘文件不动）" style="margin:0 10px 0 2px;color:var(--muted2);text-decoration:none">✕</a></span>`).join(' ');
  el.querySelectorAll('.libbtn').forEach(b => b.addEventListener('click', () => switchToLibrary(b.dataset.id)));
  el.querySelectorAll('.librm').forEach(a => a.addEventListener('click', ev => { ev.preventDefault(); removeLibFromList(a.dataset.id); }));
}

async function switchToLibrary(id) {
  const ok = await setActiveLibrary(id).catch(() => false);
  if (!ok) return;
  const libs = await getLibraries();
  const cur = libs.list.find(l => l.id === id);
  if (!cur) return;
  let perm = 'prompt';
  try { perm = await cur.handle.queryPermission({ mode: 'readwrite' }); } catch (_) {}
  if (perm !== 'granted') {
    state.root = cur.handle;
    showScreen('locked');
    return;
  }
  state.root = cur.handle;
  await ensureLibrary(state.root);
  await loadAll();
  applyQueryParam();
  renderAll();
  toast('已切换到：' + cur.name);
}

async function removeLibFromList(id) {
  const ok = await removeLibrary(id).catch(() => false);
  if (!ok) { toast('至少保留一个库'); return; }
  const libs = await getLibraries();
  if (libs && libs.activeId && libs.activeId !== (state.root && null)) {
    // 若移除的是当前库，切到剩余第一个
    const stillListed = libs.list.some(l => l.name === state.root.name);
    if (!stillListed) { await switchToLibrary(libs.activeId); toast('已从列表移除（磁盘文件未动）'); return; }
  }
  toast('已从列表移除（磁盘文件未动）');
  fillLibRow();
}

function fillBiliFolders() {
  const sel = $('biliFolder');
  if (!sel) return;
  const row = $('biliRow');
  if (row) row.hidden = false;
  sel.innerHTML = biliFolders.map(f =>
    `<option value="${f.id}">${escapeHtml(f.title)}（${f.media_count != null ? f.media_count : '?'} 条）</option>`).join('');
}

async function biliLoadFolders() {
  const st = $('biliStatus');
  $('biliRow').hidden = false;
  $('biliImport').disabled = true;
  st.textContent = '读取中…';
  try {
    if (!(await ensureBiliPerm())) { st.textContent = '未获得 B 站访问权限'; return; }
    const nav = await fetchNav();
    const ctx = wbiKeysFromNav(nav);
    if (!ctx.isLogin) { st.textContent = '未登录：请先在浏览器登录 bilibili.com，再回来点一次'; return; }
    biliCtx = ctx;
    biliFolders = await fetchFolders(ctx.mid);
    if (!biliFolders.length) { st.textContent = '没有找到收藏夹'; return; }
    fillBiliFolders();
    $('biliImport').disabled = false;
    st.textContent = '共 ' + biliFolders.length + ' 个收藏夹，选一个开始导入';
  } catch (e) {
    st.textContent = '读取失败：' + String(e.message || e).slice(0, 70);
  }
}

async function importBiliItem(m, file) {
  let coverBlob = null;
  if (m.cover) {
    try {
      const r = await fetch(m.cover, { credentials: 'omit' });
      if (r.ok) {
        const b = await r.blob();
        if (b.type.startsWith('image/')) coverBlob = b;
      }
    } catch (_) {}
  }
  const res = await saveCapture(state.root, {
    title: m.title,
    url: 'https://www.bilibili.com/video/' + m.bvid,
    vid: m.bvid,
    platform: 'bilibili',
    author: (m.upper && m.upper.name) || null,
    duration: m.duration || null,
    coverBlob,
    targetFile: file,
  });
  return res.state;
}

async function biliImport() {
  if (!biliCtx || !biliFolders.length) return;
  const folder = biliFolders.find(f => String(f.id) === $('biliFolder').value);
  if (!folder) return;
  const st = $('biliStatus');
  const btn = $('biliImport');
  btn.disabled = true;
  $('biliLoad').disabled = true;
  try {
    const filePart = ('B站·' + folder.title).replace(/[\\/:*?"<>|\r\n]/g, '').slice(0, 60) || ('bili-' + folder.id);
    const file = filePart + '.md';
    if ((await readTextFile(state.root, file)) === null) {
      await writeFile(state.root, file, '# ' + filePart + '\n');
    }
    let idxText = (await readTextFile(state.root, INDEX_FILE)) ?? '';
    const has = (await readIndexTopics(state.root)).some(t => t.file === file);
    if (!has) {
      idxText = upsertTopic(idxText, { id: 'c-bili-' + folder.id, title: filePart, file, parent: null, order: 999 }).text;
      await writeFile(state.root, INDEX_FILE, idxText);
    }
    let pn = 1, seen = 0, added = 0, dup = 0, failed = 0;
    while (pn <= 100) {
      const { medias, hasMore } = await fetchFolderPage(folder.id, pn, biliCtx.imgKey, biliCtx.subKey);
      if (!medias.length) break;
      for (const m of medias) {
        seen++;
        st.textContent = '导入中… ' + seen + ' 条（新增 ' + added + ' · 已在库 ' + dup + (failed ? ' · 失败 ' + failed : '') + '）';
        try {
          const r = await importBiliItem(m, file);
          if (r === 'duplicate') dup++; else added++;
        } catch (_) { failed++; }
        await new Promise(r => setTimeout(r, 120));
      }
      if (!hasMore) break;
      pn++;
    }
    await reloadData();
    renderContent();
    renderOpbar();
    fillBiliFolders();
    const st2 = $('biliStatus');
    if (st2) st2.textContent = '完成：新增 ' + added + ' · 已在库 ' + dup + (failed ? ' · 失败 ' + failed : '') + '（共处理 ' + seen + ' 条）';
    toast('B 站收藏夹导入：新增 ' + added + ' 条');
  } catch (e) {
    st.textContent = '导入失败：' + String(e.message || e).slice(0, 70);
  }
  btn.disabled = false;
  $('biliLoad').disabled = false;
}

// ---------------- YouTube 导入 ----------------

async function ensureYtPerm() {
  try {
    const missing = [];
    for (const o of YT_ORIGINS) {
      if (!(await chrome.permissions.contains({ origins: [o] }))) missing.push(o);
    }
    if (missing.length) return !!(await chrome.permissions.request({ origins: missing }).catch(() => false));
  } catch (_) { return true; }
  return true;
}

async function ytImport() {
  const btn = $('ytImport');
  const st = $('ytStatus');
  const url = ($('ytUrl').value || '').trim();
  if (!url) { st.textContent = '先粘贴一个播放列表链接'; return; }
  btn.disabled = true;
  const oldText = btn.textContent;
  btn.textContent = '导入中…';
  try {
    if (!(await ensureYtPerm())) { st.textContent = '未获得 YouTube 访问权限'; return; }
    st.textContent = '抓取列表…';
    const pager = await makeYtTabPaginator();
    let res;
    try {
      res = await importYoutubePlaylist({ url, cap: 500, onProgress: n => { st.textContent = '抓取列表… ' + n + ' 条'; }, contFetch: pager.contFetch });
    } finally {
      await pager.close();
    }
    if (!res.items.length) { st.textContent = '没有读到条目（列表为空或不可见）'; return; }
    const filePart = ('YouTube·' + (res.title || res.playlistId)).replace(/[\\/:*?"<>|\r\n]/g, '').slice(0, 60) || ('yt-' + res.playlistId);
    const file = filePart + '.md';
    if ((await readTextFile(state.root, file)) === null) {
      await writeFile(state.root, file, '# ' + filePart + '\n');
    }
    let idxText = (await readTextFile(state.root, INDEX_FILE)) ?? '';
    const has = (await readIndexTopics(state.root)).some(t => t.file === file);
    if (!has) {
      idxText = upsertTopic(idxText, { id: 'c-yt-' + res.playlistId, title: filePart, file, parent: null, order: 999 }).text;
      await writeFile(state.root, INDEX_FILE, idxText);
    }
    let added = 0, dup = 0, failed = 0, seen = 0;
    for (const it of res.items) {
      seen++;
      st.textContent = '导入中… ' + seen + '/' + res.items.length + '（新增 ' + added + ' · 已在库 ' + dup + (failed ? ' · 失败 ' + failed : '') + '）';
      try {
        const coverBlob = await fetchYtCover(it.videoId);
        const r = await saveCapture(state.root, {
          title: it.title,
          url: it.url,
          vid: it.videoId,
          platform: 'youtube',
          author: it.author,
          duration: it.duration,
          coverBlob,
          targetFile: file,
        });
        if (r.state === 'duplicate') dup++; else added++;
      } catch (_) { failed++; }
      await new Promise(r2 => setTimeout(r2, 120));
    }
    await reloadData();
    renderContent();
    renderOpbar();
    const st2 = $('ytStatus');
    if (st2) st2.textContent = '完成：新增 ' + added + ' · 已在库 ' + dup + (failed ? ' · 失败 ' + failed : '') + '（共处理 ' + seen + ' 条）';
    toast('YouTube 导入：新增 ' + added + ' 条');
  } catch (e) {
    st.textContent = '导入失败：' + String(e.message || e).slice(0, 80);
  }
  btn.disabled = false;
  btn.textContent = oldText;
}

async function exportWallHtml() {
  const includePrivate = !!document.querySelector('#expPriv')?.checked;
  const rows = state.entries.map(e => ({ ...e, private: isPrivateFile(e.file) }));
  const html = buildWallHtml(rows, {
    generated: new Date().toLocaleString('zh-CN', { hour12: false }),
    includePrivate,
  });
  await writeFile(state.root, 'wall.html', html);
  toast('已导出 wall.html' + (includePrivate ? '（含私密）' : '（不含私密合集）') + ' → 库根目录');
}

function renderSettings(c) {
  c.innerHTML = `
 <div style="max-width:680px">
  <div class="setrow">库目录：<b>${escapeHtml(state.root.name)}</b>　<span class="hint">（浏览器安全限制不提供完整路径）</span></div>
  <div class="setrow" id="libRow">多库：加载中…</div>
  <div class="setrow">条目：<b>${state.entries.length}</b> 条 ｜ 合集：<b>${collectionFiles().length}</b> 个</div>
  <div class="setrow">数据形态：Markdown 条目 + <code>thumbnails/</code> 封面快照　<span class="hint">建议给库目录建 git 仓库留底</span></div>
  <div class="setrow">添加库目录：<button id="repick" class="secondary" style="margin-left:10px">选择目录（添加并切换）…</button></div>
  <div class="setrow">导出静态海报墙：<button id="expWall" class="secondary" style="margin-left:10px">导出 wall.html</button><label style="margin-left:12px"><input type="checkbox" id="expPriv"> 包含私密合集</label>　<span class="hint">生成于库根目录，浏览器直接打开</span></div>
  <div class="setrow">B 站收藏夹导入：<button id="biliLoad" class="secondary" style="margin-left:10px">读取我的收藏夹</button>　<span class="hint">需在本浏览器已登录 B 站；导入会抓取标题与封面</span></div>
  <div class="setrow" id="biliRow" hidden>目标收藏夹：<select id="biliFolder" style="background:var(--input);color:var(--text);border:1px solid var(--border2);border-radius:6px;padding:6px 8px;font:inherit;max-width:320px"></select><button id="biliImport" class="secondary" disabled style="margin-left:10px">开始导入</button><span class="hint" id="biliStatus"></span></div>
  <div class="setrow">YouTube 导入：<input id="ytUrl" placeholder="播放列表链接（含 list=…；稍后观看填 WL）" style="background:var(--input);color:var(--text);border:1px solid var(--border2);border-radius:6px;padding:6px 8px;font:inherit;width:300px"> <button id="ytImport" class="secondary">导入</button>　<span class="hint" id="ytStatus">公开列表免登录 · 上限 500 条</span></div>
 </div>`;
  c.querySelector('#repick').addEventListener('click', pickDirectory);
  fillLibRow();
  c.querySelector('#expWall').addEventListener('click', exportWallHtml);
  c.querySelector('#biliLoad').addEventListener('click', biliLoadFolders);
  c.querySelector('#biliImport').addEventListener('click', biliImport);
  c.querySelector('#ytImport').addEventListener('click', ytImport);
}

// ---------------- 动作 ----------------
async function setStatus(entry, next) {
  const text = await readTextFile(state.root, entry.file);
  if (text === null) return;
  const fresh = parseEntries(text).find(e => e.key === entry.key);
  if (!fresh) return;
  const block = renderEntry({ ...fresh.meta, status: next }, extractNote(fresh.body));
  const { text: updated, found } = replaceEntry(text, entry.key, block);
  if (!found) return;
  await writeFile(state.root, entry.file, updated);
  await invalidate(entry.file);
  entry.meta.status = next;
  renderContent();
  toast('状态 → ' + next);
}

function groupByFile(targets) {
  const byFile = new Map();
  for (const t of targets) {
    if (!byFile.has(t.file)) byFile.set(t.file, []);
    byFile.get(t.file).push(t);
  }
  return byFile;
}

async function applyAuthor(name) {
  const targets = state.entries.filter(e => state.selEntries.has(e.key));
  for (const [file, list] of groupByFile(targets)) {
    let text = await readTextFile(state.root, file);
    if (text === null) continue;
    for (const t of list) {
      const fresh = parseEntries(text).find(e => e.key === t.key);
      if (!fresh) continue;
      const block = renderEntry({ ...fresh.meta, author: name }, extractNote(fresh.body));
      text = replaceEntry(text, t.key, block).text;
      t.meta.author = name;
    }
    await writeFile(state.root, file, text);
    await invalidate(file);
  }
  state.selEntries.clear();
  renderAll();
  toast('已设置作者：' + name);
}

function sanitizeName(name) {
  return String(name).replace(/[\\/:*?"<>|]+/g, '-').trim() || '未命名合集';
}

async function ensureCollectionByName(name) {
  const file = sanitizeName(name) + '.md';
  if (state.files.some(f => f.file === file)) return file;
  await writeFile(state.root, file, `# ${name}\n`);
  const indexText = (await readTextFile(state.root, INDEX_FILE)) ?? '# BookmarkDown 主题索引\n\n';
  const order = (await readIndexTopics(state.root)).length;
  const { text } = upsertTopic(indexText, { id: 'c' + Date.now(), title: name, file, parent: null, order });
  await writeFile(state.root, INDEX_FILE, text);
  state.files = await listCollectionFiles(state.root);
  return file;
}

async function transferSelected(targetFile, mode) {
  const targets = state.entries.filter(e => state.selEntries.has(e.key) && e.file !== targetFile);
  if (!targets.length) { toast('所选条目已在目标合集中'); return; }
  const blocks = [];
  for (const [file, list] of groupByFile(targets)) {
    let text = await readTextFile(state.root, file);
    if (text === null) continue;
    for (const t of list) {
      const fresh = parseEntries(text).find(e => e.key === t.key);
      if (!fresh) continue;
      blocks.push(renderEntry(fresh.meta, extractNote(fresh.body)));
      if (mode === 'move') text = removeEntry(text, t.key).text;
    }
    if (mode === 'move') {
      await writeFile(state.root, file, text);
      await invalidate(file);
    }
  }
  let target = (await readTextFile(state.root, targetFile)) ?? `# ${collectionTitle(targetFile)}\n`;
  for (const b of blocks) target = appendEntry(target, b);
  await writeFile(state.root, targetFile, target);
  await invalidate(targetFile);
  state.selEntries.clear();
  await reloadData();
  toast((mode === 'move' ? '已移动 ' : '已复制 ') + blocks.length + ' 条 → ' + collectionTitle(targetFile));
}

async function deleteEntries(keys) {
  const keySet = new Set(keys);
  const targets = state.entries.filter(e => keySet.has(e.key));
  for (const [file, list] of groupByFile(targets)) {
    let text = await readTextFile(state.root, file);
    if (text === null) continue;
    for (const t of list) text = removeEntry(text, t.key).text;
    await writeFile(state.root, file, text);
    await invalidate(file);
  }
  state.selEntries.clear();
  await reloadData();
  toast('已删除 ' + targets.length + ' 条');
}

async function deleteSelectedEntries() {
  await deleteEntries([...state.selEntries]);
}

async function deleteSelectedColls() {
  const files = [...state.selColls];
  const deletable = files.filter(f => f !== state.inboxFile);
  if (deletable.length !== files.length) toast('「默认」不能删除');
  for (const file of deletable) {
    const text = (await readTextFile(state.root, file)) ?? '';
    const blocks = parseEntries(text).map(e => renderEntry(e.meta, extractNote(e.body)));
    if (blocks.length) {
      let inboxText = (await readTextFile(state.root, state.inboxFile)) ?? `# ${collectionTitle(state.inboxFile)}\n`;
      for (const b of blocks) inboxText = appendEntry(inboxText, b);
      await writeFile(state.root, state.inboxFile, inboxText);
      await invalidate(state.inboxFile);
    }
    await state.root.removeEntry(file);
    await invalidate(file);
    const indexText = await readTextFile(state.root, INDEX_FILE);
    if (indexText) await writeFile(state.root, INDEX_FILE, removeTopic(indexText, { file }).text);
  }
  state.selColls.clear();
  await reloadData();
  toast('已删除 ' + deletable.length + ' 个合集');
}

// ---------------- 详情卡 ----------------
let detailEntry = null;

async function openDetail(entry) {
  detailEntry = entry;
  const m = entry.meta;
  const cover = m.thumbnail ? await coverUrl(m.thumbnail) : null;
  const img = $('dCover');
  const grad = $('dGrad');
  if (cover) { img.src = cover; img.hidden = false; grad.hidden = true; }
  else { img.hidden = true; grad.hidden = false; grad.textContent = PLATFORM_LABEL[m.platform] || ''; }
  $('dTitle').textContent = m.title || m.url || '';
  const rows = [
    ['合集', entry.fileTitle],
    ['平台', PLATFORM_LABEL[m.platform] || m.platform || ''],
    ['作者', m.author || ''],
    ['时长', fmtDuration(m.duration)],
    ['状态', m.status || '想看'],
    ['收藏于', m.collected || ''],
    ['链接', m.url || ''],
    ['标签', (m.tags || []).join(', ')],
    ['链接状态', linkStateText(m)],
  ].filter(r => r[1]);
  $('dRows').innerHTML = rows.map(([k, v]) => `<div class="drow"><b>${k}</b><span>${escapeHtml(v)}</span></div>`).join('');
  let note = '';
  try {
    const text = await readTextFile(state.root, entry.file);
    const fresh = text && parseEntries(text).find(x => x.key === entry.key);
    if (fresh) note = extractNote(fresh.body);
  } catch (_) {}
  const noteEl = $('dNote');
  noteEl.hidden = !note;
  noteEl.innerHTML = note ? renderNote(note) : '';
  $('detail').hidden = false;
}

function closeDetail() {
  $('detail').hidden = true;
  detailEntry = null;
}

function openViewer(src) {
  $('vImg').src = src;
  $('viewer').hidden = false;
}
function closeViewer() {
  $('viewer').hidden = true;
  $('vImg').src = '';
}
$('dCover').addEventListener('click', () => {
  if (!$('dCover').hidden && $('dCover').src) openViewer($('dCover').src);
});
$('viewer').addEventListener('click', closeViewer);

// ---------------- 补票表单（添加收藏） ----------------
let afBlob = null;
let afPreviewUrl = null;

function setAfImage(blob) {
  afBlob = blob || null;
  const img = $('afPrev');
  if (afPreviewUrl) { URL.revokeObjectURL(afPreviewUrl); afPreviewUrl = null; }
  if (afBlob) {
    afPreviewUrl = URL.createObjectURL(afBlob);
    img.src = afPreviewUrl;
    img.hidden = false;
    $('afNoimg').hidden = true;
    $('afClear').hidden = false;
  } else {
    img.hidden = true;
    img.removeAttribute('src');
    $('afNoimg').hidden = false;
    $('afClear').hidden = true;
  }
}

function openAddForm() {
  $('addform').hidden = false;
  $('afUrl').value = '';
  $('afTitle').value = '';
  $('afTarget').textContent = '保存到：' + (state.collection ? collectionTitle(state.collection) : '默认');
  setAfImage(null);
  setTimeout(() => $('afUrl').focus(), 60);
}

function closeAddForm() {
  $('addform').hidden = true;
  setAfImage(null);
}

$('btnAdd').addEventListener('click', openAddForm);
$('afCancel').addEventListener('click', closeAddForm);
$('addform').addEventListener('click', ev => { if (ev.target.id === 'addform') closeAddForm(); });
$('afPick').addEventListener('click', ev => { if (!ev.target.closest('#afClear')) $('afFile').click(); });
$('afClear').addEventListener('click', ev => { ev.stopPropagation(); setAfImage(null); });
$('afFile').addEventListener('change', () => {
  const f = $('afFile').files && $('afFile').files[0];
  if (f) setAfImage(f);
  $('afFile').value = '';
});
document.addEventListener('paste', ev => {
  const item = [...(ev.clipboardData?.items || [])].find(it => it.type.startsWith('image/'));
  if (!item) return; // 文本粘贴放行（填链接等）
  const blob = item.getAsFile();
  if (!blob) return;
  if (!$('addform').hidden) { // 表单已开：直接设为封面
    ev.preventDefault();
    setAfImage(blob);
    return;
  }
  if (!$('editform').hidden) { // 编辑表单已开：替换封面
    ev.preventDefault();
    setEfImage(blob);
    return;
  }
  const ae = document.activeElement;
  if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA')) return; // 输入框内的粘贴不劫持
  if ($('app').hidden) return; // 库页未打开
  ev.preventDefault();
  openAddForm(); // 任意处 Ctrl+V 图片 → 打开「添加收藏」并带上封面
  setAfImage(blob);
  toast('已粘贴图片作为封面');
});
const afPickEl = $('afPick');
afPickEl.addEventListener('dragover', ev => { ev.preventDefault(); afPickEl.classList.add('over'); });
afPickEl.addEventListener('dragleave', () => afPickEl.classList.remove('over'));
afPickEl.addEventListener('drop', ev => {
  ev.preventDefault();
  afPickEl.classList.remove('over');
  const f = [...(ev.dataTransfer?.files || [])].find(x => x.type.startsWith('image/'));
  if (f) setAfImage(f);
});

// ===================== 编辑收藏 =====================
let efEntry = null;          // 正在编辑的条目
let efBlob = null;           // 新选的封面 blob（优先）
let efPreviewUrl = null;     // 新封面 objectURL
let efExistingUrl = null;    // 现有封面 objectURL（来自库文件）
let efRemoveCover = false;   // 用户点击了「移除图片」

function renderEfImage() {
  const img = $('efPrev');
  const noimg = $('efNoimg');
  if (efPreviewUrl) { URL.revokeObjectURL(efPreviewUrl); efPreviewUrl = null; }
  if (efBlob) {
    efPreviewUrl = URL.createObjectURL(efBlob);
    img.src = efPreviewUrl; img.hidden = false;
    noimg.hidden = true;
    $('efClear').hidden = false;
  } else if (efRemoveCover) {
    img.hidden = true; img.removeAttribute('src');
    noimg.hidden = false;
    noimg.textContent = '封面已移除（保存后生效）· 也可点击/拖入/Ctrl+V 换新图';
    $('efClear').hidden = true;
  } else if (efExistingUrl) {
    img.src = efExistingUrl; img.hidden = false;
    noimg.hidden = true;
    $('efClear').hidden = false;
  } else {
    img.hidden = true; img.removeAttribute('src');
    noimg.hidden = false;
    noimg.textContent = '点击选择图片 · 拖入 · 或直接 Ctrl+V 粘贴';
    $('efClear').hidden = true;
  }
}

function setEfImage(blob) {
  efBlob = blob || null;
  if (blob) efRemoveCover = false;
  renderEfImage();
}

async function openEditForm(entry) {
  efEntry = entry; efBlob = null; efRemoveCover = false; efExistingUrl = null;
  $('efTitle').value = entry.meta.title || '';
  $('efUrl').value = entry.meta.url || '';
  $('efAuthor').value = entry.meta.author || '';
  $('efStatus').value = entry.meta.status || '想看';
  $('efTags').value = (entry.meta.tags || []).join(', ');
  $('efNote').value = extractNote(entry.body) || '';
  const opts = [{ file: state.inboxFile, title: '默认' },
                ...collectionFiles().map(f => ({ file: f.file, title: f.title }))];
  $('efColl').innerHTML = opts.map(o =>
    `<option value="${escapeHtml(o.file)}"${o.file === entry.file ? ' selected' : ''}>${escapeHtml(o.title)}</option>`).join('');
  if (entry.meta.thumbnail) { try { efExistingUrl = await coverUrl(entry.meta.thumbnail); } catch (_) { efExistingUrl = null; } }
  $('efMeta').textContent = (entry.meta.collected ? '收藏于 ' + entry.meta.collected + ' · ' : '')
    + (entry.meta.vid || entry.meta.platform || entry.file);
  renderEfImage();
  $('editform').hidden = false;
  setTimeout(() => $('efTitle').focus(), 60);
}

function closeEditForm() {
  $('editform').hidden = true;
  efEntry = null; efBlob = null; efRemoveCover = false; efExistingUrl = null;
  if (efPreviewUrl) { URL.revokeObjectURL(efPreviewUrl); efPreviewUrl = null; }
}

$('efPick').addEventListener('click', ev => { if (!ev.target.closest('#efClear')) $('efFile').click(); });
$('efClear').addEventListener('click', ev => { ev.stopPropagation(); efBlob = null; efRemoveCover = true; renderEfImage(); });
$('efFile').addEventListener('change', () => {
  const f = $('efFile').files && $('efFile').files[0];
  if (f) setEfImage(f);
  $('efFile').value = '';
});
const efPickEl = $('efPick');
efPickEl.addEventListener('dragover', ev => { ev.preventDefault(); efPickEl.classList.add('over'); });
efPickEl.addEventListener('dragleave', () => efPickEl.classList.remove('over'));
efPickEl.addEventListener('drop', ev => {
  ev.preventDefault();
  efPickEl.classList.remove('over');
  const f = [...(ev.dataTransfer?.files || [])].find(x => x.type.startsWith('image/'));
  if (f) setEfImage(f);
});
$('efCancel').addEventListener('click', closeEditForm);
$('editform').addEventListener('click', ev => { if (ev.target.id === 'editform') closeEditForm(); });

// 保存编辑：改元数据 / 换封面 / 移动合集（单归属）
$('efSave').addEventListener('click', async () => {
  const e = efEntry;
  if (!e) return;
  const url = $('efUrl').value.trim() || e.meta.url || '';
  if (!url) { toast('链接不能为空'); return; }
  let host = '';
  try { host = new URL(url).hostname; } catch (_) {}
  const title = $('efTitle').value.trim() || host || e.meta.title || url;
  const author = $('efAuthor').value.trim();
  const status = $('efStatus').value;
  const tags = $('efTags').value.split(/[,，]/).map(s => s.trim()).filter(Boolean);
  const noteText = $('efNote').value;
  const targetFile = $('efColl').value || e.file;
  $('efSave').disabled = true;
  try {
    let thumbnail = e.meta.thumbnail || undefined;
    if (efBlob) {
      const cov = await processCover(efBlob);
      const stem = safeStem(e.meta.vid || ('c' + Date.now()));
      const thumbDir = await state.root.getDirectoryHandle(THUMB_DIR, { create: true });
      await writeFile(thumbDir, `${stem}.${cov.ext}`, cov.blob);
      thumbnail = `${THUMB_DIR}/${stem}.${cov.ext}`;
    } else if (efRemoveCover) {
      thumbnail = undefined;
    }
    const meta = { ...e.meta, title, url, author: author || undefined, status,
      tags: tags.length ? tags : undefined, thumbnail };
    for (const k of Object.keys(meta)) if (meta[k] === undefined) delete meta[k];
    const block = renderEntry(meta, noteText);
    if (targetFile === e.file) {
      const text = (await readTextFile(state.root, e.file)) ?? '';
      const { text: updated } = replaceEntry(text, e.key, block);
      await writeFile(state.root, e.file, updated);
    } else {
      const oldText = (await readTextFile(state.root, e.file)) ?? '';
      const { text: stripped } = removeEntry(oldText, e.key);
      await writeFile(state.root, e.file, stripped);
      const newText = (await readTextFile(state.root, targetFile)) ?? `# ${targetFile.replace(/\.md$/i, '')}\n`;
      await writeFile(state.root, targetFile, appendEntry(newText, block));
    }
    closeEditForm();
    closeDetail();
    await reloadData();
    const ne = state.entries.find(x => x.key === e.key);
    if (ne) openDetail(ne);
    toast('已保存');
  } catch (err) {
    toast('保存失败：' + String(err.message || err).slice(0, 50));
  }
  $('efSave').disabled = false;
});
for (const id of ['afUrl', 'afTitle']) {
  $(id).addEventListener('keydown', ev => { if (ev.key === 'Enter') $('afSave').click(); });
}
$('afSave').addEventListener('click', async () => {
  let url = $('afUrl').value.trim();
  if (!url) { toast('链接必填'); $('afUrl').focus(); return; }
  if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) url = 'https://' + url;
  const title = $('afTitle').value.trim();
  $('afSave').disabled = true;
  try {
    const result = await saveCapture(state.root, {
      title, url, platform: 'web', coverBlob: afBlob,
      targetFile: state.collection || null,
    });
    closeAddForm();
    await reloadData();
    toast(result.state === 'duplicate'
      ? '已在库中：' + (title || url).slice(0, 32)
      : result.upgraded ? '已为已有条目补上封面'
      : '已添加 · ' + String(result.file || '').replace(/\.md$/i, ''));
  } catch (e) {
    toast('保存失败：' + String(e.message || e).slice(0, 60));
  }
  $('afSave').disabled = false;
});

$('dOpen').addEventListener('click', () => {
  const url = detailEntry?.meta?.url;
  if (url) chrome.tabs.create({ url }).catch(() => window.open(url, '_blank'));
});
$('dEdit').addEventListener('click', () => { if (detailEntry) openEditForm(detailEntry); });

// 补抓封面：按站点请求一次性权限 → 库页内直接抓取 og 元数据与封面 → 回写条目
function parseOg(html, baseUrl) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const meta = (...names) => {
    for (const n of names) {
      const el = doc.querySelector(`meta[property="${n}"], meta[name="${n}"]`);
      const c = el && el.getAttribute('content');
      if (c && c.trim()) return c.trim();
    }
    return '';
  };
  const abs = s => { try { return new URL(s, baseUrl).href; } catch (_) { return ''; } };
  return {
    title: meta('og:title', 'twitter:title') || (doc.querySelector('title')?.textContent || '').trim(),
    image: abs(meta('og:image', 'og:image:url', 'twitter:image')),
  };
}

async function refetchEntry(e) {
  const url = e.meta.url || '';
  let origin = '';
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) throw 0;
    origin = u.origin + '/*';
  } catch (_) {}
  if (!origin) { toast('此条目没有可补抓的网页链接'); return; }
  try {
    const has = await chrome.permissions.contains({ origins: [origin] });
    if (!has) {
      const granted = await chrome.permissions.request({ origins: [origin] });
      if (!granted) { toast('未获得该站点权限，无法补抓'); return; }
    }
  } catch (_) { /* API 不可用（如测试环境）时直接尝试抓取 */ }
  const btn = $('dFetch');
  const oldText = btn.textContent;
  btn.disabled = true; btn.textContent = '补抓中…';
  try {
    const resp = await fetch(url, { credentials: 'omit' });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const og = parseOg(await resp.text(), url);
    let thumb = e.meta.thumbnail || null;
    let gotCover = false;
    if (og.image && !og.image.startsWith('data:')) {
      const ir = await fetch(og.image, { credentials: 'omit' });
      if (ir.ok) {
        const blob = await ir.blob();
        if (blob.type.startsWith('image/') && blob.size <= 12 * 1024 * 1024) {
          const cov = await processCover(blob);
          const stem = safeStem(e.meta.vid || ('c' + Date.now()));
          const dir = await state.root.getDirectoryHandle(THUMB_DIR, { create: true });
          await writeFile(dir, `${stem}.${cov.ext}`, cov.blob);
          thumb = `${THUMB_DIR}/${stem}.${cov.ext}`;
          gotCover = thumb !== e.meta.thumbnail;
        }
      }
    }
    const newTitle = (og.title || '').slice(0, 200);
    const titleChanged = !!newTitle && newTitle !== e.meta.title;
    if (!gotCover && !titleChanged) { toast('没有抓到新的封面或标题'); return; }
    const meta = { ...e.meta, title: newTitle || e.meta.title };
    if (gotCover) meta.thumbnail = thumb;
    const block = renderEntry(meta, extractNote(e.body));
    const text = (await readTextFile(state.root, e.file)) ?? '';
    const { text: updated } = replaceEntry(text, e.key, block);
    await writeFile(state.root, e.file, updated);
    coverUrls.clear();
    closeDetail();
    await reloadData();
    const ne = state.entries.find(x => x.key === e.key);
    if (ne) openDetail(ne);
    toast(gotCover ? '封面已补抓' : '标题已更新');
  } catch (err) {
    toast('补抓失败：' + String(err.message || err).slice(0, 50));
  } finally {
    btn.disabled = false; btn.textContent = oldText;
  }
}
$('dFetch').addEventListener('click', () => { if (detailEntry) refetchEntry(detailEntry); });
$('btnCheck').addEventListener('click', checkLinks);
$('dClose').addEventListener('click', closeDetail);
$('dDel').addEventListener('click', () => {
  if (!detailEntry) return;
  const e = detailEntry;
  confirmBox({
    title: '删除条目',
    text: `删除「${String(e.meta.title || e.meta.url || '').slice(0, 40)}」？\n将从合集文件中移除对应区块，不可恢复（建议库目录用 git 留底）。`,
    onOk: async () => { closeDetail(); await deleteEntries([e.key]); },
  });
});
$('detail').addEventListener('click', ev => { if (ev.target.id === 'detail') closeDetail(); });
document.addEventListener('keydown', ev => {
  if (ev.key !== 'Escape') return;
  if (ev.target && ev.target.id === 'search') { ev.target.value = ''; state.search = ''; renderContent(); ev.target.blur(); return; }
  if (!$('editform').hidden) { closeEditForm(); return; }
  if (!$('addform').hidden) { closeAddForm(); return; }
  if (!$('viewer').hidden) { closeViewer(); return; }
  closeDetail();
  $('modal').hidden = true;
});

async function pickDirectory() {
  try {
    const root = await window.showDirectoryPicker({ id: 'bookmarkdown', mode: 'readwrite' });
    state.root = root;
    await setRootHandle(root);
    await upsertLibrary(root);
    await ensureLibrary(root);
    await loadAll();
    applyQueryParam();
    showScreen('app');
    renderAll();
    toast('库已就绪：' + root.name + '（已加入多库列表）');
  } catch (e) {
    if (e?.name !== 'AbortError') alert('选择目录失败：' + (e.message || e));
  }
}

// ---------------- 事件绑定 ----------------
$('search').addEventListener('input', () => { state.search = $('search').value; renderContent(); });
$('fStatus').addEventListener('change', () => { state.statusFilter = $('fStatus').value; renderContent(); });
$('fTag').addEventListener('change', () => { state.tagFilter = $('fTag').value; renderContent(); });
$('segView').querySelectorAll('span').forEach(sp => sp.addEventListener('click', () => {
  state.mode = sp.dataset.mode;
  renderTopbar();
  renderContent();
}));
$('navWall').addEventListener('click', () => { state.view = 'wall'; state.collection = null; state.batch = false; state.selEntries.clear(); renderAll(); });
$('navInbox').addEventListener('click', () => { state.view = 'wall'; state.collection = state.inboxFile; state.batch = false; state.selEntries.clear(); renderAll(); });
$('navColl').addEventListener('click', () => { state.view = 'collections'; state.batch = false; state.selEntries.clear(); renderAll(); });
$('navSet').addEventListener('click', () => { state.view = 'settings'; state.batch = false; state.selEntries.clear(); renderAll(); });

$('btnAuthor').addEventListener('click', () => {
  hideForms();
  $('authorForm').hidden = false;
  $('authorInput').focus();
});
$('authorCancel').addEventListener('click', hideForms);
$('authorApply').addEventListener('click', async () => {
  const name = $('authorInput').value.trim();
  if (!name || !state.selEntries.size) return;
  await applyAuthor(name);
  $('authorInput').value = '';
  hideForms();
});

function openTransferForm(mode) {
  state.transferMode = mode;
  hideForms();
  $('collSelect').innerHTML = state.files
    .filter(f => f.file !== state.collection)
    .map(f => `<option value="${escapeHtml(f.file)}">${escapeHtml(f.title)}</option>`).join('');
  $('collApply').textContent = mode === 'move' ? '移动' : '复制';
  $('collForm').hidden = false;
}
$('btnMoveTo').addEventListener('click', () => openTransferForm('move'));
$('btnCopyTo').addEventListener('click', () => openTransferForm('copy'));
$('collCancel').addEventListener('click', hideForms);
$('collApply').addEventListener('click', async () => {
  const name = $('collNew').value.trim();
  let targetFile;
  if (name) {
    targetFile = await ensureCollectionByName(name);
  } else {
    targetFile = $('collSelect').value;
  }
  if (!targetFile) return;
  $('collNew').value = '';
  hideForms();
  await transferSelected(targetFile, state.transferMode);
});

$('btnBatch').addEventListener('click', () => { state.batch = true; state.selEntries.clear(); hideForms(); renderAll(); });
$('btnBatchBack').addEventListener('click', () => { state.batch = false; state.selEntries.clear(); hideForms(); renderAll(); });
$('btnDelEntry').addEventListener('click', () => {
  if (!state.selEntries.size) return;
  confirmBox({
    title: '删除条目',
    text: `删除选中的 ${state.selEntries.size} 条？\n将从合集文件中移除对应区块，不可恢复（建议库目录用 git 留底）。`,
    onOk: deleteSelectedEntries,
  });
});

async function promoteOrphans(parentFiles) {
  const topics = await readIndexTopics(state.root);
  const ids = parentFiles.map(f => (topics.find(t => t.file === f) || {}).id).filter(Boolean);
  if (!ids.length) return 0;
  let text = (await readTextFile(state.root, INDEX_FILE)) ?? '';
  let n = 0;
  for (const c of topics.filter(t => t.parent && ids.includes(t.parent))) {
    text = updateTopic(text, { id: c.id }, { parent: null }).text;
    n++;
  }
  if (n) await writeFile(state.root, INDEX_FILE, text);
  return n;
}

function openHierForm() {
  hideForms();
  const selected = [...state.selColls];
  const tops = collectionFiles().filter(f => f.id && !f.parent && !selected.includes(f.file));
  $('parentSelect').innerHTML = '<option value="">顶层（不隶属于任何合集）</option>' +
    tops.map(f => `<option value="${escapeHtml(f.id)}">${escapeHtml(f.title)}</option>`).join('');
  $('hierForm').hidden = false;
}

$('btnHier').addEventListener('click', openHierForm);
$('hierCancel').addEventListener('click', hideForms);
$('hierApply').addEventListener('click', async () => {
  const targetId = $('parentSelect').value;
  const selected = [...state.selColls];
  if (!selected.length) return;
  let text = (await readTextFile(state.root, INDEX_FILE)) ?? '';
  const topics = await readIndexTopics(state.root);
  const byFile = f => topics.find(t => t.file === f);
  let promoted = 0;
  for (const f of selected) {
    const t = byFile(f);
    if (!t) continue;
    if (targetId) {
      for (const c of topics.filter(x => x.parent === t.id)) {
        text = updateTopic(text, { id: c.id }, { parent: null }).text;
        promoted++;
      }
    }
    text = updateTopic(text, { id: t.id }, { parent: targetId || null }).text;
  }
  await writeFile(state.root, INDEX_FILE, text);
  hideForms();
  state.selColls.clear();
  await reloadData();
  renderAll();
  toast((targetId ? '已设为子合集' : '已移到顶层') + (promoted ? '（' + promoted + ' 个子合集提升到顶层）' : ''));
});

function openNewCollForm() {
  hideForms();
  $('newCollName').value = '';
  $('newCollForm').hidden = false;
  $('newCollName').focus();
}
$('btnNewColl').addEventListener('click', openNewCollForm);
$('newCollCancel').addEventListener('click', hideForms);
$('newCollApply').addEventListener('click', async () => {
  const name = $('newCollName').value.trim();
  if (!name) return;
  await ensureCollectionByName(name);
  hideForms();
  await reloadData();
  toast('已创建合集：' + name);
});

$('btnPrivacy').addEventListener('click', async () => {
  const files = [...state.selColls];
  if (!files.length) return;
  const makePrivate = !files.every(f => isPrivateFile(f));
  let text = (await readTextFile(state.root, INDEX_FILE)) ?? '';
  for (const f of files) {
    text = updateTopic(text, { file: f }, { private: makePrivate ? true : undefined }).text;
  }
  await writeFile(state.root, INDEX_FILE, text);
  state.selColls.clear();
  await reloadData();
  toast((makePrivate ? '已设为私密：' : '已取消私密：') + files.map(f => collectionTitle(f)).join('、'));
});

$('btnDelColl').addEventListener('click', () => {
  if (!state.selColls.size) return;
  const files = [...state.selColls];
  const names = files.map(f => `「${collectionTitle(f)}」`).join('、');
  const cnt = files.reduce((s, f) => s + state.entries.filter(e => e.file === f).length, 0);
  confirmBox({
    title: '删除合集',
    text: `删除 ${names}？\n对应 .md 文件将从库中移出；其中 ${cnt} 条记录会移入「默认」（不会直接丢失）。`,
    onOk: async () => { await promoteOrphans(files); await deleteSelectedColls(); },
  });
});

$('pick').addEventListener('click', pickDirectory);
$('unlock').addEventListener('click', async () => {
  const root = state.root || await getActiveRoot().catch(() => null);
  if (!root) { showScreen('onboard'); return; }
  const perm = await root.requestPermission({ mode: 'readwrite' });
  if (perm === 'granted') {
    state.root = root;
    await ensureLibrary(root);
    await loadAll();
    applyQueryParam();
    showScreen('app');
    renderAll();
  } else {
    $('lockedText').textContent = '仍未授权——可再点一次「解锁库」，或重新选择目录。';
  }
});

// ---------------- 启动 ----------------
function applyQueryParam() {
  const q0 = new URLSearchParams(location.search).get('q');
  if (q0) { state.search = q0; $('search').value = q0; }
}

async function boot() {
  const root = await getActiveRoot().catch(() => null);
  if (!root) { showScreen('onboard'); return; }
  state.root = root;
  let perm = 'prompt';
  try { perm = await root.queryPermission({ mode: 'readwrite' }); } catch (_) {}
  if (perm !== 'granted') { showScreen('locked'); return; }
  await ensureLibrary(root);
  await loadAll();
  applyQueryParam();
  showScreen('app');
  renderAll();
}
boot();

// ---------------- 键盘导航（v0.2）----------------
// / 或 Ctrl+K 聚焦搜索；方向键移动卡片焦点（←→ 相邻、↑↓ 按行）；Enter 打开详情
document.addEventListener('keydown', ev => {
  const t = ev.target || {};
  const inField = ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName);
  if (!inField && (ev.key === '/' || ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'k'))) {
    ev.preventDefault();
    $('search').focus();
    $('search').select();
    return;
  }
  if (inField) return;
  if ($('app').hidden) return;
  if (document.querySelector('.modal:not([hidden]), #viewer:not([hidden])')) return;
  const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Enter'];
  if (!keys.includes(ev.key)) return;
  const cards = [...document.querySelectorAll('.wall .card')];
  if (!cards.length) return;
  const idx = cards.findIndex(c => c.classList.contains('kbd'));
  if (ev.key === 'Enter') {
    if (idx >= 0) { ev.preventDefault(); cards[idx].click(); }
    return;
  }
  ev.preventDefault();
  let step = ev.key === 'ArrowLeft' ? -1 : 1;
  if (ev.key === 'ArrowUp' || ev.key === 'ArrowDown') {
    const grid = document.querySelector('.wall');
    const cols = grid ? (getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length || 1) : 1;
    step = ev.key === 'ArrowDown' ? cols : -cols;
  }
  const next = idx < 0 ? 0 : Math.min(cards.length - 1, Math.max(0, idx + step));
  cards.forEach(c => c.classList.remove('kbd'));
  cards[next].classList.add('kbd');
  cards[next].scrollIntoView({ block: 'nearest' });
});
