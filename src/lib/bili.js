// BookmarkDown · B 站收藏夹 API 封装（运行时按站授权后可用）
import { encWbi } from './wbi.js';

const API = 'https://api.bilibili.com';

async function getJSON(url) {
  const r = await fetch(url, { credentials: 'include' });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

function apiError(j) {
  if (j.code === -101) return '未登录（请先在浏览器登录 B 站后重试）';
  if (j.code === -403) return '无权限（收藏夹不可见）';
  return (j.message || '接口错误') + '（code ' + j.code + '）';
}

export async function fetchNav() {
  return getJSON(API + '/x/web-interface/nav');
}

export function wbiKeysFromNav(nav) {
  const img = nav?.data?.wbi_img?.img_url || '';
  const sub = nav?.data?.wbi_img?.sub_url || '';
  const key = u => String(u).split('/').pop().replace(/\.\w+$/, '');
  return { imgKey: key(img), subKey: key(sub), mid: nav?.data?.mid, isLogin: !!nav?.data?.isLogin };
}

export async function fetchFolders(mid) {
  const j = await getJSON(API + `/x/v3/fav/folder/created/list-all?up_mid=${mid}&web_location=333.1387`);
  if (j.code !== 0) throw new Error(apiError(j));
  return (j.data?.list || []).filter(f => f && f.id);
}

export async function fetchFolderPage(mediaId, pn, imgKey, subKey, ps = 20) {
  const params = {
    media_id: String(mediaId), pn: String(pn), ps: String(ps),
    platform: 'web', web_location: '333.1387', order: 'mtime',
  };
  const q = encWbi(params, imgKey, subKey);
  const j = await getJSON(API + '/x/v3/fav/resource/list?' + q);
  if (j.code !== 0) throw new Error(apiError(j));
  const medias = (j.data?.medias || []).filter(m => m && m.title && m.bvid);
  return { medias, hasMore: !!j.data?.has_more, count: j.data?.info?.media_count || medias.length };
}
