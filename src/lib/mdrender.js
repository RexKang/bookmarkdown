// BookmarkDown · 笔记 Markdown 渲染（marked 本地 vendor + 轻量净化）
// renderNote: 把笔记文本渲染为可安全插入 DOM 的 HTML。
// 净化策略：洗掉危险标签/事件属性/非安全协议；相对路径（如 images/xx.webp）保留。
import { marked } from '../vendor/marked.esm.js';

const BAD_TAGS = new Set(['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'button',
  'textarea', 'select', 'option', 'meta', 'link', 'base', 'video', 'audio', 'source', 'track', 'dialog']);
const SAFE_SCHEME = /^(https?:|mailto:|#)/i;
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

export function renderNote(text) {
  const src = String(text || '').trim();
  if (!src) return '';
  const html = marked.parse(src, { async: false, gfm: true, breaks: true });
  const doc = new DOMParser().parseFromString(`<div id="bd-note-root">${html}</div>`, 'text/html');
  const rootEl = doc.getElementById('bd-note-root');
  for (const el of [...rootEl.querySelectorAll('*')]) {
    const tag = el.tagName.toLowerCase();
    if (BAD_TAGS.has(tag)) { el.remove(); continue; }
    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase();
      const val = attr.value.trim();
      if (name.startsWith('on') || name === 'style' || name === 'srcdoc') { el.removeAttribute(attr.name); continue; }
      if ((name === 'href' || name === 'src') && HAS_SCHEME.test(val) && !SAFE_SCHEME.test(val)) el.removeAttribute(attr.name);
    }
    if (tag === 'a') { el.setAttribute('target', '_blank'); el.setAttribute('rel', 'noopener noreferrer'); }
  }
  return rootEl.innerHTML;
}
