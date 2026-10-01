// BookmarkDown · IndexedDB（扩展私有）
// handles：库目录句柄（跨会话复用）；entries：条目索引缓存（库页增量渲染用）。

const DB_NAME = 'bookmarkdown';
const DB_VERSION = 2; // v2：entries 改无 keyPath —— idbSet 传显式 key 与 keyPath 冲突会抛 DataError

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('handles')) db.createObjectStore('handles');
      // entries 是纯索引缓存：升级时直接重建（无 keyPath，用 'file:<名>' 作 key）
      if (db.objectStoreNames.contains('entries')) db.deleteObjectStore('entries');
      db.createObjectStore('entries');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function idbGet(store, key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(store, 'readonly').objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}

export async function idbSet(store, key, value) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(store, 'readwrite').objectStore(store).put(value, key);
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error);
  });
}

export const getRootHandle = () => idbGet('handles', 'root');
export const setRootHandle = handle => idbSet('handles', 'root', handle);
