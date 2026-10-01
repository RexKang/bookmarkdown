// BookmarkDown · 库页主界面（v0.1.0）
// 左栏（墙 / 合集 / 设置 + 合集列表）+ 网格/列表双视图 + 合集页 + 轻编辑。
// 设计定稿：docs/0.2.0-PRD.md §2.1.5 / §7；设计稿 spike/style-drafts/。

import { getRootHandle, setRootHandle, idbGet, idbSet } from '../lib/idb.js';
import {
  ensureLibrary, listCollectionFiles, readTextFile, writeFile,
  readIndexTopics, INDEX_FILE, INBOX_ID,
} from '../lib/fs.js';
import {
  parseEntries, renderEntry, replaceEntry, removeEntry, appendEntry,
  extractNote, upsertTopic, removeTopic,
} from '../lib/md.js';

const $ = id => document.getElementById(id);

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
  for (const id of ['authorForm', 'collForm', 'newCollForm']) $(id).hidden = true;
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

function visibleEntries() {
  let list = state.entries.slice();
  if (state.collection) list = list.filter(e => e.file === state.collection);
  if (state.statusFilter) list = list.filter(e => (e.meta.status || '想看') === state.statusFilter);
  if (state.tagFilter) list = list.filter(e => (e.meta.tags || []).includes(state.tagFilter));
  const q = state.search.trim().toLowerCase();
  if (q) {
    list = list.filter(e =>
      [e.meta.title, e.meta.author, e.fileTitle].filter(Boolean).join(' ').toLowerCase().includes(q));
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
  $('collist').innerHTML = collectionFiles().map(f =>
    `<div class="subitem${state.view === 'wall' && state.collection === f.file ? ' on' : ''}" data-file="${escapeHtml(f.file)}">` +
    `<span>${escapeHtml(f.title)}</span><b>${counts.get(f.file) || 0}</b></div>`).join('');
  $('collist').querySelectorAll('.subitem').forEach(el => el.addEventListener('click', () => {
    state.view = 'wall';
    state.collection = el.dataset.file;
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

function renderOpbar() {
  const isWall = state.view === 'wall';
  const isColl = state.view === 'collections';
  $('btnAuthor').hidden = !isWall;
  $('btnColl').hidden = !isWall;
  $('btnDelEntry').hidden = !isWall;
  $('btnNewColl').hidden = !isColl;
  $('btnDelColl').hidden = !isColl;
  $('selInfo').hidden = state.view === 'settings';
  if (isColl) {
    $('selInfo').textContent = '已选 ' + state.selColls.size + ' 个';
    $('btnDelColl').disabled = state.selColls.size === 0;
  } else {
    $('selInfo').textContent = '已选 ' + state.selEntries.size + ' 条';
    $('btnDelEntry').disabled = state.selEntries.size === 0;
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
      ? '还没有收藏——在任意网页右键 →「收藏到 BookmarkDown」。'
      : state.collection === state.inboxFile
        ? '「默认」里还没有条目——新收藏会先落到这里。'
        : '该合集还没有条目——在别的合集勾选条目，用「加入合集」挪进来。';
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
  <td><div class="rname">${escapeHtml(m.title || m.url)}</div><div class="rsub">${escapeHtml([m.author, fmtDuration(m.duration)].filter(Boolean).join(' · '))}</div></td>
  <td><span class="plat">${escapeHtml(PLATFORM_LABEL[m.platform] || m.platform || '')}</span></td>
  <td><span class="colltag">${escapeHtml(e.fileTitle)}</span></td>
  <td><span class="${STATUS_CLASS[status]} stclick" data-stkey="${escapeHtml(e.key)}">${status}</span></td>
  <td class="rtime">${escapeHtml(m.collected || '')}</td>
  <td><span class="url">${escapeHtml(m.url || '')}</span></td>
 </tr>`;
  }).join('') + '</tbody></table>';
}

function bindWallEvents(c) {
  c.querySelectorAll('.enpick').forEach(el => el.addEventListener('change', () => {
    el.checked ? state.selEntries.add(el.dataset.key) : state.selEntries.delete(el.dataset.key);
    renderOpbar();
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
   <div class="cname">${escapeHtml(f.title)}</div>
   <div class="cmeta2">${escapeHtml(f.file)}</div>
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

function renderSettings(c) {
  c.innerHTML = `
 <div style="max-width:680px">
  <div class="setrow">库目录：<b>${escapeHtml(state.root.name)}</b>　<span class="hint">（浏览器安全限制不提供完整路径）</span></div>
  <div class="setrow">条目：<b>${state.entries.length}</b> 条 ｜ 合集：<b>${collectionFiles().length}</b> 个</div>
  <div class="setrow">数据形态：Markdown 条目 + <code>thumbnails/</code> 封面快照　<span class="hint">建议给库目录建 git 仓库留底</span></div>
  <div class="setrow">更换库目录：<button id="repick" class="secondary" style="margin-left:10px">重新选择目录…</button></div>
 </div>`;
  c.querySelector('#repick').addEventListener('click', pickDirectory);
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

async function moveSelectedTo(targetFile) {
  const targets = state.entries.filter(e => state.selEntries.has(e.key) && e.file !== targetFile);
  if (!targets.length) { toast('所选条目已在该合集中'); return; }
  const blocks = [];
  for (const [file, list] of groupByFile(targets)) {
    let text = await readTextFile(state.root, file);
    if (text === null) continue;
    for (const t of list) {
      const fresh = parseEntries(text).find(e => e.key === t.key);
      if (!fresh) continue;
      blocks.push(renderEntry(fresh.meta, extractNote(fresh.body)));
      text = removeEntry(text, t.key).text;
    }
    await writeFile(state.root, file, text);
    await invalidate(file);
  }
  let target = (await readTextFile(state.root, targetFile)) ?? `# ${collectionTitle(targetFile)}\n`;
  for (const b of blocks) target = appendEntry(target, b);
  await writeFile(state.root, targetFile, target);
  await invalidate(targetFile);
  state.selEntries.clear();
  await reloadData();
  toast('已加入「' + collectionTitle(targetFile) + '」');
}

async function deleteSelectedEntries() {
  const targets = state.entries.filter(e => state.selEntries.has(e.key));
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

async function pickDirectory() {
  try {
    const root = await window.showDirectoryPicker({ id: 'bookmarkdown', mode: 'readwrite' });
    state.root = root;
    await setRootHandle(root);
    await ensureLibrary(root);
    await loadAll();
    showScreen('app');
    renderAll();
    toast('库已就绪：' + root.name);
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
$('navWall').addEventListener('click', () => { state.view = 'wall'; state.collection = null; renderAll(); });
$('navInbox').addEventListener('click', () => { state.view = 'wall'; state.collection = state.inboxFile; state.selEntries.clear(); renderAll(); });
$('navColl').addEventListener('click', () => { state.view = 'collections'; renderAll(); });
$('navSet').addEventListener('click', () => { state.view = 'settings'; renderAll(); });

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

$('btnColl').addEventListener('click', () => {
  hideForms();
  $('collSelect').innerHTML = state.files.map(f =>
    `<option value="${escapeHtml(f.file)}">${escapeHtml(f.title)}</option>`).join('');
  $('collForm').hidden = false;
});
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
  await moveSelectedTo(targetFile);
});

$('btnDelEntry').addEventListener('click', () => {
  if (!state.selEntries.size) return;
  confirmBox({
    title: '删除条目',
    text: `删除选中的 ${state.selEntries.size} 条？\n将从合集文件中移除对应区块，不可恢复（建议库目录用 git 留底）。`,
    onOk: deleteSelectedEntries,
  });
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

$('btnDelColl').addEventListener('click', () => {
  if (!state.selColls.size) return;
  const files = [...state.selColls];
  const names = files.map(f => `「${collectionTitle(f)}」`).join('、');
  const cnt = files.reduce((s, f) => s + state.entries.filter(e => e.file === f).length, 0);
  confirmBox({
    title: '删除合集',
    text: `删除 ${names}？\n对应 .md 文件将从库中移出；其中 ${cnt} 条记录会移入「默认」（不会直接丢失）。`,
    onOk: deleteSelectedColls,
  });
});

$('pick').addEventListener('click', pickDirectory);
$('unlock').addEventListener('click', async () => {
  const root = state.root || await getRootHandle().catch(() => null);
  if (!root) { showScreen('onboard'); return; }
  const perm = await root.requestPermission({ mode: 'readwrite' });
  if (perm === 'granted') {
    state.root = root;
    await ensureLibrary(root);
    await loadAll();
    showScreen('app');
    renderAll();
  } else {
    $('lockedText').textContent = '仍未授权——可再点一次「解锁库」，或重新选择目录。';
  }
});

// ---------------- 启动 ----------------
async function boot() {
  const root = await getRootHandle().catch(() => null);
  if (!root) { showScreen('onboard'); return; }
  state.root = root;
  let perm = 'prompt';
  try { perm = await root.queryPermission({ mode: 'readwrite' }); } catch (_) {}
  if (perm !== 'granted') { showScreen('locked'); return; }
  await ensureLibrary(root);
  await loadAll();
  showScreen('app');
  renderAll();
}
boot();
