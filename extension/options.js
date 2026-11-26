const api = globalThis.browser || globalThis.chrome;
api.storage.local.get('base').then(v => { document.getElementById('base').value = v.base || ''; });
document.getElementById('save').onclick = async () => {
  const v = document.getElementById('base').value.trim();
  if (v && !/^https?:\/\//.test(v)) { document.getElementById('ok').textContent = 'Geen geldig adres'; return; }
  if (v) await api.storage.local.set({ base: v }); else await api.storage.local.remove('base');
  document.getElementById('ok').textContent = 'Opgeslagen';
};
