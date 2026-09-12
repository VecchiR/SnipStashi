/**
 * Hot-reload para desenvolvimento (`npm run watch`).
 * Não entra no ZIP de publicação (scripts/pack.mjs).
 */
(function startDevHotReload() {
  const DEV_WATCH_URL = "http://127.0.0.1:39217";
  let lastVersion = null;
  let waiting = false;

  async function poll() {
    if (waiting) return;
    waiting = true;
    try {
      const since = lastVersion == null ? "0" : lastVersion;
      const res = await fetch(
        `${DEV_WATCH_URL}/wait?since=${encodeURIComponent(since)}`,
        { cache: "no-store" }
      );
      if (res.ok) {
        const version = (await res.text()).trim();
        if (lastVersion !== null && version && version !== lastVersion) {
          chrome.runtime.reload();
          return;
        }
        if (version) lastVersion = version;
      }
    } catch (_) {
      await new Promise((r) => setTimeout(r, 2000));
    } finally {
      waiting = false;
      poll();
    }
  }

  poll();
})();
