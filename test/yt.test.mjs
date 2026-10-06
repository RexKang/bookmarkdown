// YouTube 导入数据层单测：node test/yt.test.mjs
// 夹具为真实页面的裁剪快照（test/fixtures/yt-*.json，均来自公开播放列表，无隐私）
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  ytPlaylistId, extractJsonAfter, extractYtPage, parseYtDuration, parseLockup,
  parsePlaylistData, parseContinuationData, ytThumbUrls,
  importYoutubePlaylist, fetchYtCover,
} from '../src/lib/yt.js';

const here = dirname(fileURLToPath(import.meta.url));
let passed = 0;
function ok(cond, name) { assert.ok(cond, name); passed++; }

console.log('· 播放列表 ID 提取');
ok(ytPlaylistId('https://www.youtube.com/playlist?list=PLabc123_-x') === 'PLabc123_-x', '标准播放列表链接');
ok(ytPlaylistId('https://www.youtube.com/watch?v=xxxx&list=PLfoo12345&index=2') === 'PLfoo12345', '观看页带 list');
ok(ytPlaylistId('https://m.youtube.com/playlist?list=LLabcdef1234') === 'LLabcdef1234', '移动域名');
ok(ytPlaylistId('WL') === 'WL', '裸 ID（稍后观看）');
ok(ytPlaylistId('https://www.youtube.com/watch?v=xxxx') === null, '无 list 参数 → null');
ok(ytPlaylistId('随便一段话') === null, '垃圾输入 → null');

console.log('· JSON 括号配对提取');
const tricky = 'xx ytInitialData = {"a":"}{\\"x\\"","b":{"c":1}}; tail';
const parsed = extractJsonAfter(tricky, 'ytInitialData');
ok(parsed && parsed.a === '}{"x"' && parsed.b.c === 1, '字符串内括号/转义安全');

console.log('· 页面参数提取');
const html = '<scr' + 'ipt>var ytInitialData = {"x":1};</scr' + 'ipt>' + '"INNERTUBE_API_KEY":"KEY123"' + '"INNERTUBE_CONTEXT_CLIENT_VERSION":"2.2026.01"';
const ep = extractYtPage(html);
ok(ep && ep.data.x === 1 && ep.apiKey === 'KEY123' && ep.clientVersion === '2.2026.01', '三要素齐全');
ok(extractYtPage('<html>无数据</html>') === null, '缺 ytInitialData → null');

console.log('· 时长解析');
ok(parseYtDuration('3:06') === 186, '3:06 → 186');
ok(parseYtDuration('1:02:33') === 3753, '1:02:33 → 3753');
ok(parseYtDuration('12:00') === 720, '12:00 → 720');
ok(parseYtDuration('LIVE') === null, 'LIVE → null');
ok(parseYtDuration('') === null, '空 → null');

console.log('· 播放列表页解析（真实 lockup 夹具）');
const fix = JSON.parse(readFileSync(join(here, 'fixtures/yt-playlist.json'), 'utf-8'));
const pp = parsePlaylistData(fix); // 完整数据 = sidebar + contents
ok(pp.items.length === 3, '3 个条目');
ok(pp.items[0].videoId === 'byxFUKxhT3s', '首个 videoId');
ok(pp.items[0].title.length > 0, '首个标题非空');
ok(pp.items[0].author && pp.items[0].author.length > 0, '频道非空');
ok(typeof pp.items[0].duration === 'number' && pp.items[0].duration > 0, '时长数字');
ok(/^https:\/\/www\.youtube\.com\/watch\?v=/.test(pp.items[0].url), 'URL 形态');
ok(pp.items[0].videoId !== pp.items[1].videoId, '相邻条目 videoId 不同');
ok(typeof pp.token === 'string' && pp.token.length > 20, '续页 token 已提取');
const titleText = fix.sidebar.playlistSidebarRenderer.items[0].playlistSidebarPrimaryInfoRenderer.title.runs.map(r => r.text).join('');
const chanText = fix.sidebar.playlistSidebarRenderer.items[1].playlistSidebarSecondaryInfoRenderer.videoOwner.videoOwnerRenderer.title.runs.map(r => r.text).join('');
ok(pp.title === titleText, '标题与夹具一致');
ok(pp.channel === chanText, '频道与夹具一致');
ok(parseLockup({ contentType: 'LOCKUP_CONTENT_TYPE_PLAYLIST', contentId: 'x' }) === null, '非视频类型 → null');

console.log('· 续页响应解析（真实快照）');
const fix2 = JSON.parse(readFileSync(join(here, 'fixtures/yt-continuation.json'), 'utf-8'));
const pc = parseContinuationData(fix2);
ok(pc.items.length === 2, '续页 2 条');
ok(pc.items[0].videoId === 'uP_iLS38Tdo', '续页首条 videoId');
ok(pc.token === 'CONT-TEST-TOKEN-2', '续页下个 token');

console.log('· 导入编排（桩 fetch）');
const fixtureHtml = 'var ytInitialData = ' + JSON.stringify(fix) + ';' + '"INNERTUBE_API_KEY":"K"' + '"INNERTUBE_CONTEXT_CLIENT_VERSION":"2.0"';
const calls = [];
const stubFetch = async (url) => {
  calls.push(url);
  if (url.includes('/playlist?list=')) return { ok: true, status: 200, async text() { return fixtureHtml; } };
  if (url.includes('/youtubei/v1/browse')) return { ok: true, status: 200, async json() { return fix2; } };
  return { ok: false, status: 404, async text() { return ''; }, async json() { throw new Error('nf'); } };
};
const progress = [];
const res = await importYoutubePlaylist({ url: 'https://www.youtube.com/playlist?list=PLtest12345', fetchFn: stubFetch, cap: 4, onProgress: n => progress.push(n) });
ok(res.items.length === 4, 'cap=4 生效');
ok(res.title === titleText, '标题透传');
ok(res.items[3].videoId === 'uP_iLS38Tdo', '第 4 条来自续页');
ok(calls.filter(u => u.includes('/youtubei/')).length === 1, '续页接口调用 1 次');
ok(progress.length >= 2, 'onProgress 有回调');
const calls2 = [];
const stubFetch2 = async (url) => {
  calls2.push(url);
  if (url.includes('/playlist?list=')) return { ok: true, status: 200, async text() { return fixtureHtml; } };
  if (url.includes('/youtubei/v1/browse')) return { ok: true, status: 200, async json() { return fix2; } };
  return { ok: false, status: 404, async text() { return ''; }, async json() { throw new Error('nf'); } };
};
const res2 = await importYoutubePlaylist({ url: 'https://www.youtube.com/playlist?list=PLtest12345', fetchFn: stubFetch2, cap: 500 });
ok(res2.items.length === 5, '重复令牌下总条数 3+2=5');
ok(calls2.filter(u => u.includes('/youtubei/')).length === 2, '重复令牌在第 2 次续页后终止');

let threw = '';
try { await importYoutubePlaylist({ url: '随便', fetchFn: stubFetch }); } catch (e) { threw = String(e.message); }
ok(threw.includes('无法从链接'), '无效链接报错');

console.log('· 封面回退');
const small = { type: 'image/jpeg', size: 1024 };
const big = { type: 'image/jpeg', size: 12000 };
const tried = [];
const cover = await fetchYtCover('vid1', async u => { tried.push(u); return { ok: true, async blob() { return u.includes('maxres') ? small : big; } }; });
ok(cover === big, 'maxres 占位 → 取 sddefault');
ok(tried.length === 2 && tried[0].includes('maxresdefault') && tried[1].includes('sddefault'), '回退顺序正确');
const none = await fetchYtCover('vid2', async () => ({ ok: false, status: 404, async blob() { return small; } }));
ok(none === null, '全失败 → null');
ok(ytThumbUrls('abc')[0] === 'https://i.ytimg.com/vi/abc/maxresdefault.jpg', '缩略图 URL 模板');

console.log(`\n全部通过：${passed} 项断言`);
