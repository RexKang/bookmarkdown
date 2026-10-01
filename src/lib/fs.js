// BookmarkDown · 库目录读写层
// index.md 合集清单、合集文件读写、封面 webp 落盘、settings.json、去重。
// 除 toWebp（需浏览器图像 API）外全部可与 node 单测共用（配内存假目录）。

import {
  parseEntries, renderEntry, appendEntry, replaceEntry, extractNote,
  parseTopics, upsertTopic, removeTopic,
} from './md.js';
import { normalizeUrl, entryKey, safeStem, nowStamp } from './util.js';

export const INDEX_FILE = 'index.md';
export const SETTINGS_FILE = 'settings.json';
export const THUMB_DIR = 'thumbnails';
export const INBOX_ID = 'inbox';
export const INBOX_TITLE = '默认';
export const DEFAULT_INBOX_FILE = '默认.md';

export const DEFAULT_EXCLUDES = [
  'chrome://*', 'chrome-extension://*', 'edge://*', 'about:*',
  'https://chrome.google.com/webstore/*', 'https://microsoftedge.microsoft.com/addons/*',
];

/** 读取文本文件；不存在返回 null */
export async function readTextFile(dir, name) {
  try {
    return await (await dir.getFileHandle(name)).getFile().then(f => f.text());
  } catch (e) {
    if (e?.name === 'NotFoundError') return null;
    throw e;
  }
}

/** 写入文件（字符串或 Blob） */
export async function writeFile(dir, name, data) {
  const handle = await dir.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  await writable.write(data);
  await writable.close();
}

async function readIndexRaw(root) {
  return (await readTextFile(root, INDEX_FILE)) ?? '# BookmarkDown 主题索引\n\n';
}

export async function readIndexTopics(root) {
  return parseTopics(await readIndexRaw(root));
}

/** 默认容器文件：由 index.md 的 inbox 主题决定，缺省 默认.md */
export async function inboxFile(root) {
  const topics = await readIndexTopics(root);
  return topics.find(t => t.id === INBOX_ID)?.file || DEFAULT_INBOX_FILE;
}

/** 初始化/修复库：确保 index.md 有「默认」容器、默认文件存在；旧库（收件箱）自动迁移 */
export async function ensureLibrary(root) {
  const topics = await readIndexTopics(root);
  const inboxTopic = topics.find(t => t.id === INBOX_ID);
  if (inboxTopic && (inboxTopic.title !== INBOX_TITLE || inboxTopic.file !== DEFAULT_INBOX_FILE)) {
    // 旧版兼容：标题「收件箱」/文件「收件箱.md」→「默认」/「默认.md」
    const oldFile = inboxTopic.file;
    const oldText = oldFile ? await readTextFile(root, oldFile) : null;
    if (oldText !== null && (await readTextFile(root, DEFAULT_INBOX_FILE)) === null) {
      await writeFile(root, DEFAULT_INBOX_FILE, oldText);
    }
    if (oldText !== null && oldFile !== INDEX_FILE && /\.md$/i.test(oldFile)) {
      try { await root.removeEntry(oldFile); } catch (_) { /* 删不掉就留着 */ }
    }
    let idx = await readIndexRaw(root);
    idx = removeTopic(idx, { id: INBOX_ID }).text;
    idx = upsertTopic(idx, { ...inboxTopic, title: INBOX_TITLE, file: DEFAULT_INBOX_FILE }).text;
    await writeFile(root, INDEX_FILE, idx);
  }
  if (!(await readIndexTopics(root)).some(t => t.id === INBOX_ID)) {
    const { text } = upsertTopic(await readIndexRaw(root), {
      id: INBOX_ID, title: INBOX_TITLE, file: DEFAULT_INBOX_FILE, parent: null, order: 0,
    });
    await writeFile(root, INDEX_FILE, text);
  }
  const inbox = await inboxFile(root);
  if ((await readTextFile(root, inbox)) === null) {
    await writeFile(root, inbox, `# ${INBOX_TITLE}\n`);
  }
  return { inbox };
}

/** 全部合集文件：index.md 清单优先（保序），再补目录中人工放入的散装 .md */
export async function listCollectionFiles(root) {
  const out = [];
  const seen = new Set();
  for (const t of await readIndexTopics(root)) {
    if (t.file && /\.md$/i.test(t.file) && !seen.has(t.file)) {
      seen.add(t.file);
      out.push({ file: t.file, title: t.title || t.file.replace(/\.md$/i, '') });
    }
  }
  for await (const [name, handle] of root.entries()) {
    if (handle.kind !== 'file' || seen.has(name)) continue;
    if (!/\.md$/i.test(name) || name === INDEX_FILE || name.toLowerCase() === 'readme.md') continue;
    seen.add(name);
    out.push({ file: name, title: name.replace(/\.md$/i, '') });
  }
  return out;
}

export async function readSettings(root) {
  const text = await readTextFile(root, SETTINGS_FILE);
  if (text === null) {
    const settings = { excludedPatterns: DEFAULT_EXCLUDES };
    await writeFile(root, SETTINGS_FILE, JSON.stringify(settings, null, 2) + '\n');
    return settings;
  }
  try {
    return JSON.parse(text);
  } catch {
    return { excludedPatterns: DEFAULT_EXCLUDES };
  }
}

function wildcardMatch(value, pattern) {
  try {
    return new RegExp('^' + String(pattern).replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$', 'i')
      .test(value || '');
  } catch {
    return false;
  }
}

export async function isExcludedBySettings(url, root) {
  const settings = await readSettings(root);
  return (settings.excludedPatterns || DEFAULT_EXCLUDES).some(p => wildcardMatch(url, p));
}

/** 压缩为 webp（缩略图 maxWidth 640，质量 0.75）。浏览器环境使用（SW / 库页均可） */
export async function toWebp(blob) {
  const bitmap = await createImageBitmap(blob);
  const scale = Math.min(1, 640 / bitmap.width);
  const canvas = new OffscreenCanvas(
    Math.max(1, Math.round(bitmap.width * scale)),
    Math.max(1, Math.round(bitmap.height * scale)),
  );
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.convertToBlob({ type: 'image/webp', quality: 0.75 });
}

function mapPlatform(p) {
  return (!p || p === 'generic') ? 'web' : p;
}

/**
 * 保存一条收藏（写盘 + 去重 + 封面落盘）。
 * record: { title, url, vid, platform, author, duration, coverBlob(Blob|null), note, targetFile }
 * targetFile: 新条目写入的文件（补票表单「写入当前合集」用；缺省默认容器）
 * 返回: { state: 'saved' | 'duplicate', file, key, thumbnail, upgraded? }
 */
export async function saveCapture(root, record) {
  await ensureLibrary(root);
  const key = entryKey({ vid: record.vid, url: record.url });
  const normUrl = normalizeUrl(record.url);

  // 去重：扫描全部合集文件（key 优先，归一化 URL 兜底）
  const files = await listCollectionFiles(root);
  let existing = null;
  let existingFile = null;
  for (const f of files) {
    const text = await readTextFile(root, f.file);
    if (!text) continue;
    const hit = parseEntries(text).find(e =>
      e.key === key || (e.meta.url && normalizeUrl(e.meta.url) === normUrl));
    if (hit) { existing = hit; existingFile = f.file; break; }
  }

  const hasCover = !!record.coverBlob;
  if (existing && (existing.meta.thumbnail || !hasCover)) {
    return { state: 'duplicate', file: existingFile, key };
  }

  // 封面落盘（新封面或补图升级）
  let thumbnail = existing?.meta.thumbnail || null;
  if (hasCover) {
    const stem = safeStem(record.vid || ('c' + Date.now()));
    const thumbDir = await root.getDirectoryHandle(THUMB_DIR, { create: true });
    await writeFile(thumbDir, `${stem}.webp`, await toWebp(record.coverBlob));
    thumbnail = `${THUMB_DIR}/${stem}.webp`;
  }

  const meta = {
    key,
    title: record.title || existing?.meta.title || record.url,
    url: record.url || existing?.meta.url,
    vid: record.vid || existing?.meta.vid,
    platform: mapPlatform(record.platform || existing?.meta.platform),
    author: record.author || existing?.meta.author,
    duration: record.duration || existing?.meta.duration,
    thumbnail: thumbnail || undefined,
    status: existing?.meta.status || '想看',
    collected: existing?.meta.collected || nowStamp(),
  };
  if (existing?.meta.tags) meta.tags = existing.meta.tags;
  const note = existing ? extractNote(existing.body) : (record.note || '');
  const block = renderEntry(meta, note);

  if (existing) {
    const text = (await readTextFile(root, existingFile)) ?? '';
    const { text: updated } = replaceEntry(text, existing.key, block);
    await writeFile(root, existingFile, updated);
    return { state: 'saved', file: existingFile, key, thumbnail, upgraded: true };
  }

  let target = record.targetFile || null;
  if (target && (await readTextFile(root, target)) === null) target = null;
  const file = target || await inboxFile(root);
  const text = (await readTextFile(root, file)) ?? `# ${file.replace(/\.md$/i, '')}\n`;
  await writeFile(root, file, appendEntry(text, block));
  return { state: 'saved', file, key, thumbnail };
}
