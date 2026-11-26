/* Op elke pagina: Alt-klik op een beeld bewaart het in Collector. */
(() => {
  const api = globalThis.browser || globalThis.chrome;
  let box;
  function toast(text, ok) {
    if (!box) {
      box = document.createElement('div');
      box.style.cssText = 'position:fixed;z-index:2147483647;left:50%;bottom:28px;transform:translateX(-50%);background:#1d1d1f;color:#fff;font:500 13px/1.3 -apple-system,system-ui,sans-serif;padding:9px 16px;border-radius:999px;box-shadow:0 8px 28px rgba(0,0,0,.3);pointer-events:none;transition:opacity .2s';
      (document.body || document.documentElement).append(box);
    }
    box.textContent = text; box.style.opacity = '1';
    box.style.background = ok === false ? '#b3261e' : '#1d1d1f';
    clearTimeout(box._t); box._t = setTimeout(() => { box.style.opacity = '0'; }, ok === undefined ? 8000 : 2200);
  }
  addEventListener('click', e => {
    if (!e.altKey || e.button !== 0) return;
    const img = e.target instanceof Element && (e.target.closest('img') || (e.target.querySelector && e.target.querySelector(':scope > img')));
    const url = img && (img.currentSrc || img.src);
    if (!url || !/^https?:/.test(url)) return;
    e.preventDefault(); e.stopPropagation();
    toast('Bewaren…');
    api.runtime.sendMessage({ save: { url, page: location.href, title: document.title } })
      .then(r => toast(r && r.ok ? 'Bewaard in Collector' : 'Niet gelukt' + (r && r.error ? ': ' + r.error : ''), !!(r && r.ok)), () => toast('Niet gelukt', false));
  }, true);
  api.runtime.onMessage.addListener(msg => { if (msg && msg.toast) toast(msg.toast, msg.ok); });
})();
