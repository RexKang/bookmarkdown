// BookmarkDown · Side Panel：边看视频边翻库（单列海报墙）
import { getRootHandle } from '../lib/idb.js';
import { loadEntries, filterEntries, thumbUrl } from '../lib/quicklist.js';

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let all = [];
let rootRef = null;

async function render() {
  const list = filterEntries(all, $('q').value).slice(0, 80);
  const el = $('col');
  if (!all.length) { el.innerHTML = '<div class="empty">库是空的——右键任意网页收藏第一页</div>'; return; }
  if (!list.length) { el.innerHTML = '<div class="empty">没有匹配的收藏</div>'; return; }
  el.innerHTML = list.map(e => {
    const m = e.meta;
    return `<div class="sc">
      ${m.thumbnail ? '<img class="cv" alt="">' : `<div class="cv grad">${esc(String(m.platform || 'web').toUpperCase().slice(0, 6))}</div>`}
      <div class="bd"><div class="t">${esc(m.title || m.url || '未命名')}</div>
      <div class="m">${esc([m.author, m.collected].filter(Boolean).join(' · '))}</div></div>
    </div>`;
  }).join('');
  [...el.querySelectorAll('.sc')].forEach((it, i) => {
    const e = list[i];
    it.addEventListener('click', () => { if (e.meta.url) chrome.tabs.create({ url: e.meta.url }); });
    const img = it.querySelector('img.cv');
    if (img && e.meta.thumbnail && rootRef) thumbUrl(rootRef, e.meta.thumbnail).then(u => {
      if (u) {
        img.src = u;
        const apply = () => {
          if (!img.naturalWidth || !img.naturalHeight) return;
          const r = img.naturalWidth / img.naturalHeight;
          img.classList.toggle('fit-sq', r > 0.96 && r < 1.04);
        };
        if (img.complete && img.naturalWidth) apply();
        else img.addEventListener('load', apply, { once: true });
      }
    });
  });
}
$('q').addEventListener('input', render);
$('reload').addEventListener('click', load);

async function load() {
  rootRef = await getRootHandle().catch(() => null);
  if (!rootRef) { $('col').innerHTML = '<div class="empty">尚未设置库目录——打开库页选择一次</div>'; return; }
  try {
    const perm = await rootRef.queryPermission({ mode: 'readwrite' });
    if (perm !== 'granted') { $('col').innerHTML = '<div class="empty">库需要授权——打开库页解锁一次</div>'; return; }
    all = await loadEntries(rootRef);
    await render();
  } catch (e) { $('col').innerHTML = '<div class="empty">读取失败：' + esc(e.message || e) + '</div>'; }
}
load();
