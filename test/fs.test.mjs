// 库目录读写层单测：node test/fs.test.mjs
// 用内存假目录模拟 File System Access API 的最小面（getFileHandle/getDirectoryHandle/
// entries/queryPermission/createWritable/getFile）。全部为合成数据。
import assert from 'node:assert/strict';
import {
  ensureLibrary, saveCapture, listCollectionFiles, inboxFile,
  readSettings, isExcludedBySettings,
} from '../src/lib/fs.js';
import { parseEntries, parseTopics } from '../src/lib/md.js';

class FakeFile {
  constructor(name) { this.kind = 'file'; this.name = name; this._content = ''; }
  async getFile() { const self = this; return { async text() { return self._content; } }; }
  async createWritable() {
    const self = this;
    return {
      async write(data) { self._content = typeof data === 'string' ? data : String(data); },
      async close() {},
    };
  }
}

class FakeDir {
  constructor(name = 'lib') { this.kind = 'directory'; this.name = name; this.map = new Map(); }
  async getFileHandle(name, opts = {}) {
    let h = this.map.get(name);
    if (!h) {
      if (!opts.create) { const e = new Error('not found: ' + name); e.name = 'NotFoundError'; throw e; }
      h = new FakeFile(name); this.map.set(name, h);
    }
    return h;
  }
  async getDirectoryHandle(name, opts = {}) {
    let h = this.map.get(name);
    if (!h) {
      if (!opts.create) { const e = new Error('not found: ' + name); e.name = 'NotFoundError'; throw e; }
      h = new FakeDir(name); this.map.set(name, h);
    }
    return h;
  }
  async *entries() { for (const pair of this.map) yield pair; }
  async queryPermission() { return 'granted'; }
}

let passed = 0;
function ok(cond, name) {
  assert.ok(cond, name);
  passed++;
  console.log('  ok -', name);
}

console.log('· 初始化库');
const root = new FakeDir();
await ensureLibrary(root);
ok(root.map.has('index.md'), 'index.md 已创建');
ok(parseTopics(root.map.get('index.md')._content).length === 1, '收件箱主题已写入');
ok(root.map.has('收件箱.md'), '收件箱.md 已创建');
ok((await inboxFile(root)) === '收件箱.md', 'inboxFile 返回收件箱.md');
await ensureLibrary(root);
ok(parseTopics(root.map.get('index.md')._content).length === 1, '重复初始化不重复主题');

console.log('· 收藏写入与去重');
const r1 = await saveCapture(root, {
  title: '示例视频一', url: 'https://www.bilibili.com/video/BV1TEST0001?spm_id_from=333.1',
  vid: 'BV1TEST0001', platform: 'bilibili', author: '示例UP主', duration: 123, coverBlob: null,
});
ok(r1.state === 'saved' && r1.file === '收件箱.md', '首条写入收件箱');
let text = root.map.get('收件箱.md')._content;
ok(parseEntries(text).length === 1, '收件箱解析出 1 条');
ok(parseEntries(text)[0].meta.status === '想看', '默认状态为 想看');
ok(parseEntries(text)[0].meta.platform === 'bilibili', '平台字段正确');
const r2 = await saveCapture(root, {
  title: '示例视频一', url: 'https://www.bilibili.com/video/BV1TEST0001?vd_source=x',
  vid: 'BV1TEST0001', platform: 'bilibili', coverBlob: null,
});
ok(r2.state === 'duplicate', '同 vid 重复收藏被识别（跟踪参数不同）');
ok(parseEntries(root.map.get('收件箱.md')._content).length === 1, '重复时不新增条目');

console.log('· 无 vid 条目按 URL 去重');
const r3 = await saveCapture(root, { title: '示例网页', url: 'https://example.com/a?utm_source=x', platform: 'generic', coverBlob: null });
const r4 = await saveCapture(root, { title: '示例网页', url: 'https://example.com/a?utm_medium=y', platform: 'generic', coverBlob: null });
ok(r3.state === 'saved' && r4.state === 'duplicate', 'URL 归一化后识别重复');
ok(parseEntries(root.map.get('收件箱.md')._content).length === 2, '库里共 2 条');

console.log('· 人工放入的散装 md 文件');
const stray = new FakeFile('散装.md');
stray._content = '# 散装\n';
root.map.set('散装.md', stray);
const files = await listCollectionFiles(root);
ok(files.some(f => f.file === '散装.md' && f.title === '散装'), '散装 md 被识别为合集');
ok(!files.some(f => f.file === 'index.md'), 'index.md 不算合集');

console.log('· settings.json 兜底与排除规则');
const st = await readSettings(root);
ok(Array.isArray(st.excludedPatterns) && st.excludedPatterns.length > 0, '默认排除规则已生成');
ok(await isExcludedBySettings('chrome://extensions', root) === true, 'chrome:// 命中排除');
ok(await isExcludedBySettings('https://example.com/x', root) === false, '普通页面不排除');

console.log(`\n全部通过：${passed} 项断言`);
