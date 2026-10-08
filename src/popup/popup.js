// BookmarkDown · popup：快搜 + 最近收藏 + 收藏当前页
import { getRootHandle } from '../lib/idb.js';
import { loadEntries, filterEntries, thumbUrl } from '../lib/quicklist.js';

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let all = [];
let rootRef = null;

async function render() {
  const list = filterEntries(all, $('q').value).slice(0, 20);
  const el = $('list');
  if (!all.length) { el.innerHTML = '<div class="empty">库是空的——右键任意网页收藏第一页</div>'; return; }
  if (!list.length) { el.innerHTML = '<div class="empty">没有匹配的收藏</div>'; return; }
  el.innerHTML = list.map(e => `
    <div class="item"><img class="th" alt="">
      <div class="tx"><div class="t">${esc(e.meta.title || e.meta.url || '未命名')}</div>
      <div class="m">${esc([e.meta.author, e.meta.platform, e.meta.collected].filter(Boolean).join(' · '))}</div></div>
    </div>`).join('');
  [...el.querySelectorAll('.item')].forEach((it, i) => {
    const e = list[i];
    it.addEventListener('click', () => { if (e.meta.url) chrome.tabs.create({ url: e.meta.url }); });
    if (e.meta.thumbnail && rootRef) thumbUrl(rootRef, e.meta.thumbnail).then(u => { if (u) it.querySelector('.th').src = u; });
  });
}

$('q').addEventListener('input', render);
$('q').addEventListener('keydown', ev => {
  if (ev.key !== 'Enter') return;
  const q = $('q').value.trim();
  const u = chrome.runtime.getURL('src/library/library.html') + (q ? ('?q=' + encodeURIComponent(q)) : '');
  chrome.tabs.create({ url: u });
  window.close();
});
$('collect').addEventListener('click', async () => {
  $('collect').disabled = true;
  $('status').textContent = '收藏中…';
  try {
    const r = await chrome.runtime.sendMessage({ type: 'collect-current' });
    $('status').textContent = r?.ok ? (r.state === 'duplicate' ? '已在库中（未重复收藏）' : '已收藏 ✓') : '失败：' + (r?.error || '未知错误');
  } catch (e) { $('status').textContent = '失败：' + (e.message || e); }
  setTimeout(init, 1200);
});
$('open').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('src/library/library.html') });
});
$('panel').addEventListener('click', async () => {
  try {
    // 兼容两种命名空间（Chrome 148+ 起同时提供 browser.*；未授予 sidePanel 权限时两者皆无）
    const sp = (typeof browser !== 'undefined' && browser && browser.sidePanel)
      || (typeof chrome !== 'undefined' && chrome.sidePanel) || null;
    if (!sp || typeof sp.open !== 'function') {
      $('status').textContent = '此浏览器未开放侧栏 API。若扩展刚更新过：到 chrome://extensions 点「重新加载」（或移除后重新加载）再试';
      return;
    }
    const w = await chrome.windows.getCurrent();
    await sp.open({ windowId: w.id });
    window.close();
  } catch (e) { $('status').textContent = '侧栏打开失败：' + (e.message || e); }
});

async function init() {
  rootRef = await getRootHandle().catch(() => null);
  if (!rootRef) { $('status').textContent = '尚未设置库目录——点「打开库」先选择目录。'; return; }
  let perm = 'prompt';
  try { perm = await rootRef.queryPermission({ mode: 'readwrite' }); } catch (_) {}
  if (perm !== 'granted') { $('status').textContent = '库需要授权——打开库页点「解锁库」。'; return; }
  $('collect').disabled = false;
  try {
    all = await loadEntries(rootRef);
    $('cnt').textContent = all.length + ' 条';
    $('status').textContent = '共 ' + all.length + ' 条 · 回车进入全页墙';
    await render();
  } catch (e) { $('status').textContent = '读取库失败：' + (e.message || e); }
}
init();
