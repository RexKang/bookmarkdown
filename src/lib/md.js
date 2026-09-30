// BookmarkDown · 合集文件文本层
// 纯函数、无 I/O、无浏览器依赖：扩展（MV3）与 node 单测共用。
// 文件格式见 docs/0.2.0-PRD.md §5.2：条目 = 隐藏标记（单行 JSON）+ ## 小节。

import { normalizeUrl, entryKey } from './util.js';

const ENTRY_RE = /<!-- bookmarkdown-entry (\{.*\}) -->\r?\n([\s\S]*?)<!-- \/bookmarkdown-entry -->/g;
const TOPIC_RE = /<!-- bookmarkdown-topic (\{.*\}) -->/g;

/** 解析合集文件 → [{ key, meta, raw, start, end, body }] */
export function parseEntries(text) {
  const out = [];
  for (const m of String(text).matchAll(ENTRY_RE)) {
    let meta;
    try { meta = JSON.parse(m[1]); } catch { continue; }
    out.push({
      key: meta.key || '',
      meta,
      raw: m[0],
      start: m.index,
      end: m.index + m[0].length,
      body: m[2].trim(),
    });
  }
  return out;
}

/** 按 key 查条目 */
export function findEntry(text, key) {
  return parseEntries(text).find(e => e.key === key) || null;
}

/** 按归一化 URL 查条目 */
export function findEntryByUrl(text, url) {
  const norm = normalizeUrl(url);
  return parseEntries(text).find(e => e.meta.url && normalizeUrl(e.meta.url) === norm) || null;
}

/** 渲染条目区块（隐藏标记 + 人类可读小节）。meta.key 缺省时按 vid/URL 生成。 */
export function renderEntry(meta, note = '') {
  const m = { ...meta };
  m.key = m.key || entryKey(m);
  m.status = m.status || '想看';
  const title = sanitizeTitle(m.title) || m.url || '未命名';
  const lines = [`<!-- bookmarkdown-entry ${JSON.stringify(m)} -->`, `## ${title}`, ''];
  if (m.url) lines.push(`- URL: ${m.url}`);
  if (m.platform) lines.push(`- 平台: ${m.platform}`);
  if (m.vid) lines.push(`- 视频 ID: ${m.vid}`);
  if (m.author) lines.push(`- 作者: ${m.author}`);
  if (m.duration) lines.push(`- 时长: ${m.duration} 秒`);
  lines.push(`- 状态: ${m.status}`);
  if (m.collected) lines.push(`- 收藏于: ${m.collected}`);
  if (Array.isArray(m.tags) && m.tags.length) lines.push(`- 标签: ${m.tags.join(', ')}`);
  if (m.thumbnail) lines.push('', `![封面](${m.thumbnail})`);
  const n = String(note || '').trim();
  if (n) lines.push('', n);
  lines.push('<!-- /bookmarkdown-entry -->');
  return lines.join('\n');
}

/** 用新区块替换旧条目；找不到时返回 found: false */
export function replaceEntry(text, key, block) {
  const e = findEntry(text, key);
  if (!e) return { text, found: false };
  return { text: text.slice(0, e.start) + block + text.slice(e.end), found: true };
}

/** 删除条目（保留其余内容，收敛多余空行） */
export function removeEntry(text, key) {
  const e = findEntry(text, key);
  if (!e) return { text, removed: false };
  const t = (text.slice(0, e.start) + text.slice(e.end))
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\s+$/, '\n');
  return { text: t, removed: true };
}

/** 追加条目区块到文件末尾 */
export function appendEntry(text, block) {
  return `${String(text).replace(/\s+$/, '')}\n\n${block}\n`;
}

/** 解析 index.md → 合集清单 [{ id, title, file, parent, order }] */
export function parseTopics(indexText) {
  const out = [];
  for (const m of String(indexText).matchAll(TOPIC_RE)) {
    try { out.push(JSON.parse(m[1])); } catch { /* 跳过坏标记 */ }
  }
  return out;
}

export function renderTopic(topic) {
  return `<!-- bookmarkdown-topic ${JSON.stringify(topic)} -->\n- [${topic.title}](${topic.file})`;
}

/** 清单中不存在时追加该合集；已存在（按 id 或 file 判定）原样返回 */
export function upsertTopic(indexText, topic) {
  const topics = parseTopics(indexText);
  if (topics.some(t => t.id === topic.id || t.file === topic.file)) {
    return { text: indexText, topics };
  }
  const base = String(indexText).replace(/\s+$/, '');
  return { text: `${base}\n\n${renderTopic(topic)}\n`, topics: [...topics, topic] };
}

function sanitizeTitle(value) {
  return String(value || '').replace(/[\r\n#]+/g, ' ').replace(/\s+/g, ' ').trim();
}
