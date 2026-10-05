// BookmarkDown · popup / Side Panel 共用的轻量列表数据层
import { listCollectionFiles, readTextFile } from './fs.js';
import { parseEntries } from './md.js';

/** 读全库条目（按收藏时间倒序） */
export async function loadEntries(root) {
  const files = await listCollectionFiles(root);
  const out = [];
  for (const f of files) {
    const text = await readTextFile(root, f.file);
    if (!text) continue;
    for (const e of parseEntries(text)) out.push({ ...e, file: f.file });
  }
  out.sort((a, b) => String(b.meta.collected || '').localeCompare(String(a.meta.collected || '')));
  return out;
}

/** 关键词过滤（标题/作者/标签/URL） */
export function filterEntries(list, q) {
  const s = String(q || '').trim().toLowerCase();
  if (!s) return list;
  return list.filter(e => [e.meta.title, e.meta.author, e.meta.url, (e.meta.tags || []).join(' ')]
    .filter(Boolean).join(' ').toLowerCase().includes(s));
}

/** 缩略图相对路径 → objectURL（失败返回 null） */
export async function thumbUrl(root, relPath) {
  if (!relPath) return null;
  try {
    const parts = String(relPath).split('/');
    let dir = root;
    for (let i = 0; i < parts.length - 1; i++) dir = await dir.getDirectoryHandle(parts[i]);
    return URL.createObjectURL(await (await dir.getFileHandle(parts[parts.length - 1])).getFile());
  } catch (_) { return null; }
}
