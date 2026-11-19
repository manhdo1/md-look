import { $ } from "../core/dom.js";

function getAppWindow() {
  return window.__TAURI__?.window?.getCurrentWindow?.() ?? null;
}

async function syncMaximized(win) {
  const btn = $("btn-win-max");
  if (!btn || !win) return;
  try {
    const maximized = await win.isMaximized();
    document.documentElement.dataset.maximized = maximized ? "true" : "false";
    btn.title = maximized ? "Restore" : "Maximize";
    btn.setAttribute("aria-label", maximized ? "Restore" : "Maximize");
  } catch (_) {
    /* ignore */
  }
}

export function initWindowControls() {
  const win = getAppWindow();
  if (!win) return;

  $("btn-win-min")?.addEventListener("click", () => {
    void win.minimize();
  });
  $("btn-win-max")?.addEventListener("click", () => {
    void win.toggleMaximize().then(() => syncMaximized(win));
  });
  $("btn-win-close")?.addEventListener("click", () => {
    void win.close();
  });

  void syncMaximized(win);
  void win.onResized(() => {
    void syncMaximized(win);
  });
  void win.onMoved(() => {
    void syncMaximized(win);
  });
}
