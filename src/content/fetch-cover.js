// 通道一：在页面内 fetch 封面（借 activeTab 临时授权，无 host_permissions）。
// 重要：本函数必须自包含——不得引用模块作用域中的任何变量或 import。
// 通道二（可见区截图）由 Service Worker 直接用 chrome.tabs.captureVisibleTab 兜底。

export async function fetchCoverInPage(url) {
  try {
    const r = await fetch(url, { mode: 'cors', credentials: 'omit' });
    if (!r.ok) return { ok: false, err: 'HTTP ' + r.status };
    const b = await r.blob();
    if (!b.type.startsWith('image/')) return { ok: false, err: 'not image: ' + b.type };
    const b64 = await new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(/^data:([^;]+);base64,(.*)$/.exec(fr.result)?.[2]);
      fr.onerror = () => reject(fr.error);
      fr.readAsDataURL(b);
    });
    return { ok: true, bytes: b.size, mime: b.type, b64 };
  } catch (e) {
    return { ok: false, err: (e.message || '').slice(0, 80) };
  }
}
