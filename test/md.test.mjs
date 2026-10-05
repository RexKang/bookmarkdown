// 合集文件文本层单测：node test/md.test.mjs
// 样例数据全部为合成内容，不含任何真实数据。
import assert from 'node:assert/strict';
import { parseEntries, findEntry, findEntryByUrl, renderEntry, replaceEntry, removeEntry, appendEntry, extractNote, parseTopics, upsertTopic, removeTopic, updateTopic, renderTopic } from '../src/lib/md.js';
import { normalizeUrl, safeStem, nowStamp } from '../src/lib/util.js';

let passed = 0;
function ok(cond, name) {
  assert.ok(cond, name);
  passed++;
  console.log('  ok -', name);
}

console.log('· 渲染与解析（roundtrip）');
const e1 = renderEntry({
  key: 'vid:BV1TEST0001', title: '示例视频：K8s 网络原理',
  url: 'https://www.bilibili.com/video/BV1TEST0001?spm_id_from=333.1&vd_source=abc',
  vid: 'BV1TEST0001', platform: 'bilibili', author: '示例UP主', duration: 506,
  thumbnail: 'thumbnails/BV1TEST0001.webp', status: '在看', collected: '2026-09-30 10:00',
});
let text = `# 示例合集\n\n${e1}\n`;
let entries = parseEntries(text);
ok(entries.length === 1, '解析出 1 个条目');
ok(entries[0].meta.title === '示例视频：K8s 网络原理', '标题正确');
ok(entries[0].meta.status === '在看', '状态正确');
ok(entries[0].meta.author === '示例UP主', '作者正确');
ok(e1.includes('- 状态: 在看'), '人类可读行包含状态');
ok(e1.includes('![封面](thumbnails/BV1TEST0001.webp)'), '封面行存在');

console.log('· 追加与检索');
const e2 = renderEntry({ title: '示例视频二：无ID 无封面', url: 'https://example.com/watch?v=abc&utm_source=x', platform: 'web', status: '想看', collected: '2026-09-30 11:00' });
const e3 = renderEntry({ title: '示例视频三', url: 'https://www.youtube.com/watch?v=demo1234567', vid: 'demo1234567', platform: 'youtube', author: '示例频道', duration: 1786, thumbnail: 'thumbnails/demo1234567.webp', status: '想看', collected: '2026-09-30 11:30' }, '我的笔记一行');
text = appendEntry(appendEntry(text, e2), e3);
entries = parseEntries(text);
ok(entries.length === 3, '共 3 个条目');
ok(entries[1].key === 'url:https://example.com/watch?v=abc', '无 vid 用归一化 URL 作键（去掉 utm_source）');
ok(entries[2].body.includes('我的笔记一行'), '笔记并入区块');
ok(extractNote(entries[2].body) === '我的笔记一行', 'extractNote 从区块提取笔记');
ok(findEntry(text, 'vid:demo1234567')?.meta.platform === 'youtube', '按 key 查到条目');
ok(findEntryByUrl(text, 'https://example.com/watch?v=abc&utm_medium=y')?.key === entries[1].key, '按 URL（含跟踪参数差异）查到同一条');

console.log('· 替换 / 删除 / 移动');
const updated = replaceEntry(text, 'vid:BV1TEST0001', renderEntry({ ...parseEntries(text)[0].meta, status: '看过' }, ''));
ok(updated.found && parseEntries(updated.text)[0].meta.status === '看过', '替换状态为 看过');
const removed = removeEntry(updated.text, 'url:https://example.com/watch?v=abc');
ok(removed.removed && parseEntries(removed.text).length === 2, '删除后剩 2 条');
ok(!/\n{3,}/.test(removed.text), '删除后无多余空行');
const first = parseEntries(removed.text)[0].meta;
const moved = appendEntry(removed.text, renderEntry(first));
ok(parseEntries(moved).at(-1).key === first.key, '条目可追加到文件末尾（模拟换合集第二步）');

console.log('· CRLF 容错');
ok(parseEntries(text.replace(/\n/g, '\r\n')).length === 3, 'CRLF 文件解析正常');

console.log('· index.md 合集清单');
const idx = '# BookmarkDown 主题索引\n\n';
const up1 = upsertTopic(idx, { id: 'inbox', title: '收件箱', file: '收件箱.md', parent: null, order: 0 });
ok(upsertTopic(up1.text, { id: 'inbox', title: '收件箱', file: '收件箱.md', parent: null, order: 0 }).text === up1.text, '重复 upsert 不重复追加');
const up2 = upsertTopic(up1.text, { id: 'tech', title: '技术', file: '技术.md', parent: null, order: 1 });
ok(parseTopics(up2.text).length === 2 && parseTopics(up2.text)[1].file === '技术.md', '新合集追加成功');
const { text: idxTrimmed, removed: idxRemovedFlag } = removeTopic(up2.text, { file: '技术.md' });
ok(idxRemovedFlag && parseTopics(idxTrimmed).length === 1, 'removeTopic 按 file 移除');
ok(!idxTrimmed.includes('技术.md'), '移除后无残留');

console.log('· 工具函数');
ok(normalizeUrl('https://x.com/a?utm_a=1&spm=2&keep=3#h') === 'https://x.com/a?keep=3', 'normalizeUrl 去跟踪参数与 hash');
ok(safeStem('BV1TEST0001') === 'BV1TEST0001', 'safeStem 保留字母数字');
ok(safeStem('中文标题') === 'item', 'safeStem 中文回退 item');
ok(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(nowStamp()), 'nowStamp 格式');

console.log('· updateTopic 更新合集字段');
const idxU = '# 索引\n\n' + renderTopic({ id: 'c1', title: '硬件', file: '硬件.md', parent: null, order: 1 }) + '\n';
const u1 = updateTopic(idxU, { file: '硬件.md' }, { private: true });
ok(u1.updated === true, '更新命中');
ok(parseTopics(u1.text)[0].private === true, 'private 已写入');
ok(u1.text.includes('- [硬件](硬件.md)'), '链接行保留');
const u2 = updateTopic(u1.text, { file: '硬件.md' }, { private: undefined });
ok(parseTopics(u2.text)[0].private === undefined, 'undefined 删除字段');
const u3 = updateTopic(u2.text, { file: '不存在.md' }, { private: true });
ok(u3.updated === false, '未命中返回 false');
const u4 = updateTopic(u2.text, { id: 'c1' }, { title: '硬件设备' });
ok(parseTopics(u4.text)[0].title === '硬件设备' && u4.text.includes('- [硬件设备](硬件.md)'), '按 id 更新并可改标题');

console.log('· 标题后缀剥离');
ok(renderEntry({ key: 'k1', title: '视频标题_哔哩哔哩_bilibili', url: 'https://b23.tv/x' }).includes('## 视频标题\n'), 'B站后缀剥离');
ok(renderEntry({ key: 'k1b', title: '视频标题_哔哩哔哩_bilibili', url: 'https://b23.tv/x' }).includes('"title":"视频标题"'), '存储 meta 标题也剥尾');
ok(renderEntry({ key: 'k2', title: 'How to X - YouTube', url: 'https://youtu.be/x' }).includes('## How to X\n'), 'YouTube 后缀剥离');
ok(renderEntry({ key: 'k3', title: '带-横杠的-标题', url: 'https://e.com/x' }).includes('## 带-横杠的-标题\n'), '普通标题不动');

console.log(`\n全部通过：${passed} 项断言`);
