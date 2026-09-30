// BookmarkDown · 通用纯函数（扩展与 node 单测共用）

const TRACKING_PARAM_RE = /^(utm_|spm|vd_source|from|share_source)/i;

/** 去跟踪参数与 hash 的归一化 URL（去重比较用） */
export function normalizeUrl(value) {
  try {
    const url = new URL(value);
    for (const key of [...url.searchParams.keys()]) {
      if (TRACKING_PARAM_RE.test(key)) url.searchParams.delete(key);
    }
    url.hash = '';
    return url.href.replace(/\/$/, '');
  } catch {
    return String(value || '').trim();
  }
}

/** 文件名安全 stem（无 vid 的条目用） */
export function safeStem(value) {
  return String(value || 'item')
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'item';
}

/** 去重键：vid 优先，否则归一化 URL */
export function entryKey(meta) {
  return meta.vid ? `vid:${meta.vid}` : `url:${normalizeUrl(meta.url)}`;
}

/** 本地时间戳 "YYYY-MM-DD HH:mm" */
export function nowStamp(date = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())} ${p(date.getHours())}:${p(date.getMinutes())}`;
}
