// BookmarkDown · 静态导出 单测
import { buildWallHtml } from '../src/lib/export-wall.js';

let passed = 0;
function ok(cond, name) {
  if (!cond) { console.error('FAIL:', name); process.exitCode = 1; }
  passed++;
  console.log((cond ? '  ok ' : '  FAIL ') + name);
}

const E = [
  { key: 'k1', file: '默认.md', private: false, meta: { title: '正常条目<script>alert(1)</script>', url: 'https://example.com/a', author: '作者A', tags: ['标签1'], thumbnail: 'thumbnails/a.webp', platform: 'bilibili', collected: '2026-10-01 10:00' } },
  { key: 'k2', file: '私密.md', private: true, meta: { title: '私密条目', url: 'https://example.com/b', tags: ['隐藏'] } },
  { key: 'k3', file: '默认.md', private: false, meta: { title: '坏缩略图', url: 'javascript:alert(1)', thumbnail: '../evil.webp' } },
];

console.log('· 基本结构');
const h1 = buildWallHtml(E, { generated: '2026-10-05 12:00' });
ok(h1.includes('正常条目&lt;script&gt;alert(1)&lt;/script&gt;'), '标题 HTML 转义');
ok(!h1.includes('<script>alert(1)</script>'), '无注入脚本');
ok(!h1.includes('私密条目'), '默认排除私密合集');
ok(h1.includes('共 2 条'), '计数正确（排除私密后 2 条）');
ok(h1.includes('href="https://example.com/a"'), '正常链接保留');

console.log('· 安全过滤');
ok(!h1.includes('javascript:'), 'javascript: 链接被剥除');
ok(!h1.includes('../evil.webp'), '非法缩略图路径被剥除');
ok(h1.includes('坏缩略图'), '无图条目仍渲染');

console.log('· 含私密');
const h2 = buildWallHtml(E, { includePrivate: true, generated: '' });
ok(h2.includes('私密条目'), '包含私密合集生效');
ok(h2.includes('共 3 条'), '计数 3 条');

console.log('· 1:1 封面留白（v0.4.1）');
ok(h2.includes('.cv img.fit-sq'), '导出含留白样式');
ok(h2.includes("querySelectorAll('.cv img')"), '导出含留白脚本');

console.log('· 空库');
const h3 = buildWallHtml([], {});
ok(h3.includes('没有可展示的条目'), '空库占位');

console.log(`\n全部通过：${passed} 项断言`);
