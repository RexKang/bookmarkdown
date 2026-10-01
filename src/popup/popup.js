import { getRootHandle } from '../lib/idb.js';

const statusEl = document.getElementById('status');
const collectBtn = document.getElementById('collect');

async function refresh() {
  const root = await getRootHandle().catch(() => null);
  if (!root) {
    statusEl.textContent = '尚未设置库目录——点「打开库」先选择目录。';
    collectBtn.disabled = true;
    return;
  }
  let perm = 'prompt';
  try { perm = await root.queryPermission({ mode: 'readwrite' }); } catch (_) {}
  if (perm === 'granted') {
    statusEl.textContent = '库已就绪：' + root.name;
    collectBtn.disabled = false;
  } else {
    statusEl.textContent = '库需要授权——打开库页点「解锁库」。';
    collectBtn.disabled = true;
  }
}

collectBtn.addEventListener('click', async () => {
  collectBtn.disabled = true;
  statusEl.textContent = '收藏中…';
  try {
    const r = await chrome.runtime.sendMessage({ type: 'collect-current' });
    statusEl.textContent = r?.ok
      ? (r.state === 'duplicate' ? '已在库中（未重复收藏）' : '已收藏 ✓')
      : '失败：' + (r?.error || '未知错误');
  } catch (e) {
    statusEl.textContent = '失败：' + (e.message || e);
  }
  setTimeout(refresh, 1500);
});

document.getElementById('open').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('src/library/library.html') });
});

refresh();
