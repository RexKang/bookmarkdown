// 页面元数据抓取（经 chrome.scripting.executeScript 注入到页面主世界执行）。
// 重要：本函数必须自包含——不得引用模块作用域中的任何变量或 import。
// 平台分支内联在此（注入函数无法 import 适配器模块）；未适配平台回落 og 通用路径。

export function grabPage(srcUrl, linkUrl) {
  const og = {};
  for (const m of document.querySelectorAll('meta[property^="og:"], meta[name^="og:"]')) {
    const p = m.getAttribute('property') || m.getAttribute('name');
    if (m.content) og[p.slice(3)] = m.content;
  }
  const out = { og, srcUrl, linkUrl, platform: 'generic' };
  const host = location.hostname;

  // 平台深度适配：B站（window.__INITIAL_STATE__ 挂在主世界）
  if (/bilibili\.com$/.test(host)) {
    out.platform = 'bilibili';
    try {
      const s = window.__INITIAL_STATE__;
      if (s && s.videoData) {
        out.bili = {
          bvid: s.videoData.bvid,
          owner: s.videoData.owner && s.videoData.owner.name,
          duration: s.videoData.duration,
          pubdate: s.videoData.pubdate,
        };
        if (!out.og.image && s.videoData.pic) out.og.image = s.videoData.pic;
      }
    } catch (e) { /* 忽略 */ }
  }

  // 平台深度适配：YouTube（ytInitialPlayerResponse）
  if (/youtube\.com$/.test(host) || /youtu\.be$/.test(host)) {
    out.platform = 'youtube';
    try {
      const url = new URL(location.href);
      const det = window.ytInitialPlayerResponse && window.ytInitialPlayerResponse.videoDetails;
      const videoId = (det && det.videoId) || url.searchParams.get('v') ||
        (host.endsWith('youtu.be') ? location.pathname.slice(1) : null);
      if (videoId) {
        out.yt = {
          videoId,
          channel: det && det.author,
          lengthSeconds: det && det.lengthSeconds,
          viewCount: det && det.viewCount,
        };
        // YouTube 页面常无可用 og:image；按视频 ID 取 CDN 海报作稳定兜底
        if (!out.og.image) out.og.image = 'https://i.ytimg.com/vi/' + encodeURIComponent(videoId) + '/hqdefault.jpg';
      }
    } catch (e) { /* 忽略 */ }
  }

  // 链接上下文：尝试取链接内嵌图片（图路）
  if (linkUrl) {
    try {
      const img = document.querySelector('a[href="' + linkUrl + '"] img');
      if (img && img.src) out.linkImg = img.src;
    } catch (e) { /* 选择器失败忽略 */ }
  }

  return out;
}
