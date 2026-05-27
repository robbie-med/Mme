// PWA install prompt + offline-status indicator wiring.

export function wirePWA() {
  let deferredPrompt = null;
  const installRow = document.getElementById('install-row');
  const installBtn = document.getElementById('install-btn');
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferredPrompt = e;
    if (installRow) installRow.hidden = false;
  });
  if (installBtn) {
    installBtn.addEventListener('click', async () => {
      if (!deferredPrompt) return;
      installBtn.disabled = true;
      deferredPrompt.prompt();
      try { await deferredPrompt.userChoice; } catch (e) {}
      deferredPrompt = null;
      if (installRow) installRow.hidden = true;
    });
  }
  window.addEventListener('appinstalled', () => {
    if (installRow) installRow.hidden = true;
  });

  const offlineEl = document.getElementById('offline-status');
  function updateOfflineStatus() {
    if (!offlineEl) return;
    const swActive = 'serviceWorker' in navigator && navigator.serviceWorker.controller;
    const online = navigator.onLine;
    const parts = [];
    parts.push(online ? 'Online' : 'Offline');
    parts.push(swActive ? 'cached for offline use' : 'cache initializing (reload once)');
    offlineEl.textContent = parts.join(' · ');
  }
  updateOfflineStatus();
  window.addEventListener('online', updateOfflineStatus);
  window.addEventListener('offline', updateOfflineStatus);
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.ready.then(updateOfflineStatus).catch(() => {});
  }
}
