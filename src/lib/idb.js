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

// ---------------- 多库（v0.3.1）----------------
// 'libs' = { activeId, list: [{ id, name, handle }] }；旧单库 'root' 自动迁移
export const getLibraries = () => idbGet('handles', 'libs');
export const setLibraries = v => idbSet('handles', 'libs', v);

/** 当前库根（含旧单库迁移） */
export async function getActiveRoot() {
  let libs = await getLibraries().catch(() => null);
  if (!libs || !Array.isArray(libs.list) || !libs.list.length) {
    const legacy = await getRootHandle().catch(() => null);
    if (legacy) {
      libs = { activeId: 'lib-legacy', list: [{ id: 'lib-legacy', name: legacy.name || '库', handle: legacy }] };
      await setLibraries(libs).catch(() => {});
    }
    return legacy || null;
  }
  const active = libs.list.find(l => l.id === libs.activeId) || libs.list[0];
  return active ? active.handle : null;
}

/** 添加/更新库并设为当前（同名视为同一库，更新句柄） */
export async function upsertLibrary(handle) {
  let libs = await getLibraries().catch(() => null);
  if (!libs || !Array.isArray(libs.list)) {
    libs = { activeId: null, list: [] };
    const legacy = await getRootHandle().catch(() => null);
    if (legacy) libs.list.push({ id: 'lib-legacy', name: legacy.name || '库', handle: legacy });
  }
  const dup = libs.list.find(l => l.name === handle.name);
  if (dup) {
    dup.handle = handle;
    libs.activeId = dup.id;
  } else {
    const id = 'lib-' + Date.now().toString(36);
    libs.list.push({ id, name: handle.name, handle });
    libs.activeId = id;
  }
  await setLibraries(libs);
  return libs.activeId;
}

export async function setActiveLibrary(id) {
  const libs = await getLibraries().catch(() => null);
  if (!libs || !Array.isArray(libs.list)) return false;
  if (!libs.list.some(l => l.id === id)) return false;
  libs.activeId = id;
  await setLibraries(libs);
  return true;
}

export async function removeLibrary(id) {
  const libs = await getLibraries().catch(() => null);
  if (!libs || !Array.isArray(libs.list)) return false;
  if (libs.list.length <= 1) return false; // 至少保留一个
  libs.list = libs.list.filter(l => l.id !== id);
  if (libs.activeId === id || !libs.list.some(l => l.id === libs.activeId)) libs.activeId = libs.list[0].id;
  await setLibraries(libs);
  return true;
}
