// BookmarkDown · 静态海报墙 HTML 生成（纯函数，node 可测）
const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const safeHttpUrl = u => (/^https?:\/\//i.test(String(u || '')) ? String(u) : '');
const safeThumb = p => (/^thumbnails\/[\w.\-]+$/i.test(String(p || '')) ? String(p) : '');

export function buildWallHtml(entries, { title = 'BookmarkDown 海报墙', generated = '', includePrivate = false } = {}) {
  const list = (entries || []).filter(e => includePrivate || !e.private);
  const cards = list.map(e => {
    const m = e.meta || {};
    const url = safeHttpUrl(m.url);
    const thumb = safeThumb(m.thumbnail);
    const tags = (m.tags || []).map(t => `<span class="tg">#${esc(t)}</span>`).join(' ');
    const search = [m.title, m.author, (m.tags || []).join(' '), e.file || '', url].filter(Boolean).join(' ').toLowerCase();
    const cover = thumb
      ? `<img src="${esc(thumb)}" loading="lazy" alt="">`
      : `<div class="grad">${esc(String(m.platform || 'web').toUpperCase().slice(0, 6))}</div>`;
    const cov = url ? `<a class="cv" href="${esc(url)}" target="_blank" rel="noopener">${cover}</a>` : `<div class="cv">${cover}</div>`;
    const t = url ? `<a class="t" href="${esc(url)}" target="_blank" rel="noopener">${esc(m.title || m.url || '未命名')}</a>`
                  : `<span class="t">${esc(m.title || '未命名')}</span>`;
    return `  <div class="card" data-s="${esc(search)}">
   ${cov}
   <div class="bd">${t}
    <div class="m">${esc([m.author, m.platform, m.collected].filter(Boolean).join(' · '))}</div>
    <div class="tgline">${tags}</div>
   </div>
  </div>`;
  }).join('\n');
  return `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #0f1218; color: #f2f4f8; font: 14px/1.6 system-ui, "Microsoft YaHei", sans-serif; }
  .head { position: sticky; top: 0; z-index: 2; padding: 14px 18px; background: rgba(15,18,24,.93);
          backdrop-filter: blur(6px); border-bottom: 1px solid #1d2433; display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
  .head h1 { font-size: 16px; margin: 0; }
  .head h1 i { display: inline-block; width: 6px; height: 18px; border-radius: 2px; background: #e50914; margin-right: 8px; vertical-align: -3px; }
  .head .meta { color: #96a0b2; font-size: 12.5px; }
  .head input { margin-left: auto; background: #171c26; border: 1px solid #2a3143; border-radius: 8px; color: #f2f4f8;
                padding: 7px 10px; font: inherit; outline: none; min-width: 240px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 14px; padding: 16px 18px 40px; }
  .card { background: #131824; border: 1px solid #1d2433; border-radius: 10px; overflow: hidden; display: flex; flex-direction: column; }
  .card:hover { border-color: #2a3143; }
  .cv { display: block; aspect-ratio: 16 / 9; background: #1d2433; overflow: hidden; }
  .cv img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .cv img.fit-sq { object-fit: contain; background: #1d2433; }
  .cv .grad { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; color: #96a0b2; font-weight: 700; }
  .bd { padding: 10px 12px 12px; display: flex; flex-direction: column; gap: 4px; }
  .t { color: #f2f4f8; font-weight: 600; text-decoration: none; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .t:hover { color: #7ea6e8; }
  .m { color: #96a0b2; font-size: 12px; }
  .tgline { display: flex; flex-wrap: wrap; gap: 4px; }
  .tg { color: #8fb4ee; font-size: 11.5px; background: #1a2030; border-radius: 999px; padding: 1px 8px; }
  .empty { color: #96a0b2; padding: 40px 18px; }
  footer { color: #96a0b2; font-size: 12px; text-align: center; padding: 0 0 28px; }
</style>
</head>
<body>
<div class="head">
  <h1><i></i>${esc(title)}</h1>
  <span class="meta">共 ${list.length} 条${generated ? ' · 导出于 ' + esc(generated) : ''}</span>
  <input id="q" placeholder="过滤标题 / 作者 / 标签…">
</div>
<div class="grid" id="grid">
${cards || '  <div class="empty">（空）没有可展示的条目</div>'}
</div>
<footer>BookmarkDown 静态导出 · 封面位于同目录 thumbnails/ 下</footer>
<script>
(function () {
  var q = document.getElementById('q');
  var cards = [].slice.call(document.querySelectorAll('.card'));
  q.addEventListener('input', function () {
    var s = q.value.trim().toLowerCase();
    cards.forEach(function (c) {
      c.style.display = !s || (c.getAttribute('data-s') || '').indexOf(s) >= 0 ? '' : 'none';
    });
  });
  [].slice.call(document.querySelectorAll('.cv img')).forEach(function (img) {
    var ap = function () {
      if (!img.naturalWidth || !img.naturalHeight) return;
      var r = img.naturalWidth / img.naturalHeight;
      if (r > 0.96 && r < 1.04) img.classList.add('fit-sq');
    };
    if (img.complete && img.naturalWidth) ap(); else img.addEventListener('load', ap);
  });
})();
</script>
</body>
</html>
`;
}
