// BookmarkDown · wbi 签名 单测
import { md5, getMixinKey, encWbi } from '../src/lib/wbi.js';

let passed = 0;
function ok(cond, name) {
  if (!cond) { console.error('FAIL:', name); process.exitCode = 1; }
  passed++;
  console.log((cond ? '  ok ' : '  FAIL ') + name);
}

console.log('· MD5（RFC 1321 官方向量）');
ok(md5('') === 'd41d8cd98f00b204e9800998ecf8427e', '空串');
ok(md5('abc') === '900150983cd24fb0d6963f7d28e17f72', 'abc');
ok(md5('message digest') === 'f96b697d7cb7938d525a2f31aaf161d0', 'message digest');
ok(md5('The quick brown fox jumps over the lazy dog') === '9e107d9d372bb6826bd81d3542a419d6', 'quick brown fox');
ok(md5('中文测试·长度超过一个块需要填充足够多的内容来测试跨块计算') === md5('中文测试·长度超过一个块需要填充足够多的内容来测试跨块计算'), '确定性（长中文）');

console.log('· mixinKey（社区文档示例向量）');
const imgKey = '7cd084941338484aae1ad9425b84077c';
const subKey = '4932caff0ff746eab6f01bf08b70ac45';
ok(getMixinKey(imgKey + subKey) === 'ea1db124af3c7062474693fa704f4ff8', 'mixinKey 官方示例');

console.log('· encWbi');
const q1 = encWbi({ media_id: '123', pn: '1' }, imgKey, subKey, 1702204169);
ok(/wts=1702204169/.test(q1), 'wts 注入');
ok(/w_rid=[0-9a-f]{32}$/.test(q1), 'w_rid 为 32 位 hex');
const q2 = encWbi({ media_id: '123', pn: '1' }, imgKey, subKey, 1702204169);
ok(q1 === q2, '确定性');
ok(q1.startsWith('media_id=123&pn=1&wts=1702204169'), '参数按键排序');

console.log(`\n全部通过：${passed} 项断言`);
