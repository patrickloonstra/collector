/* Op de Collector-pagina: geeft beelden van de extensie door aan de app. */
(() => {
  const api = globalThis.browser || globalThis.chrome;
  api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg) return;
    if (msg.ping) { sendResponse({ ready: document.documentElement.dataset.collectorReady === '1' }); return; }
    if (!msg.collectorAdd) return;
    const id = Math.random().toString(36).slice(2);
    const timer = setTimeout(() => { removeEventListener('message', on); sendResponse({ ok: false }); }, 30000);
    function on(e) {
      if (e.source !== window || !e.data || e.data.type !== 'collector-ext-done' || e.data.id !== id) return;
      clearTimeout(timer); removeEventListener('message', on); sendResponse({ ok: !!e.data.ok });
    }
    addEventListener('message', on);
    window.postMessage({ type: 'collector-ext-add', id, ...msg.collectorAdd }, location.origin);
    return true;
  });
})();
