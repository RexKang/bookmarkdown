// 最小库页：选择库目录 / 解锁授权 / 库状态。
// 完整海报墙（左栏 + 网格/列表 + 合集页）按定稿设计稿在下一阶段替换本页。
import { getRootHandle, setRootHandle } from '../lib/idb.js';
import { ensureLibrary, listCollectionFiles, readTextFile } from '../lib/fs.js';
import { parseEntries } from '../lib/md.js';

const $ = id => document.getElementById(id);

function show(which) {
  for (const id of ['onboard', 'locked', 'ready']) $(id).hidden = id !== which;
}

async function boot() {
  const root = await getRootHandle().catch(() => null);
  if (!root) return show('onboard');
  let perm = 'prompt';
  try { perm = await root.queryPermission({ mode: 'readwrite' }); } catch (_) {}
  if (perm === 'granted') return ready(root);
  show('locked');
}

async function ready(root) {
  show('ready');
  $('libName').textContent = root.name;
  try {
    const files = await listCollectionFiles(root);
    const rows = [];
    for (const f of files) {
      const text = (await readTextFile(root, f.file)) || '';
      rows.push(`${f.title}（${parseEntries(text).length} 条）`);
    }
    $('files').textContent = rows.join(' · ') || '（空库）';
  } catch (e) {
    $('files').textContent = '读取失败：' + (e.message || e);
  }
}

$('pick').addEventListener('click', async () => {
  try {
    const root = await window.showDirectoryPicker({ id: 'bookmarkdown', mode: 'readwrite' });
    await setRootHandle(root);
    await ensureLibrary(root);
    await ready(root);
  } catch (e) {
    if (e?.name !== 'AbortError') alert('选择目录失败：' + (e.message || e));
  }
});

$('unlock').addEventListener('click', async () => {
  const root = await getRootHandle().catch(() => null);
  if (!root) return show('onboard');
  const perm = await root.requestPermission({ mode: 'readwrite' });
  if (perm === 'granted') {
    await ensureLibrary(root);
    await ready(root);
  } else {
    $('locked').querySelector('p').textContent = '仍未授权——可再点一次「解锁库」，或重新选择目录。';
  }
});

boot();
