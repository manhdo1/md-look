/* markdown-look frontend — no Markdown parser; Rust supplies HTML + outline. */

import { DEFAULT_SIDEBAR_WIDTH } from "./core/constants.js";
import { getPrefs, onDocChanged, onOpenPaths, takePendingPaths } from "./core/ipc.js";
import { state } from "./core/state.js";
import { initBanner, showError } from "./widgets/banner.js";
import { initDiagrams } from "./content/diagrams.js";
import { initDiagramDialog } from "./content/diagram-dialog.js";
import { initMediaEmbeds } from "./content/media-embeds.js";
import { initFind, refreshFind } from "./views/find.js";
import {
  applyPrefs,
  clampSidebarWidth,
  initOutlineToggle,
  initResizer,
  initThemeToggle,
  initZoom,
} from "./views/layout.js";
import { initScrollSpy, initWindowResize } from "./views/outline.js";
import { initRecent, renderRecent } from "./views/recent.js";
import { updateStatus } from "./views/status.js";
import { initOpenButtons, openMany, openPath, showEmpty } from "./features/documents.js";
import { initLinks } from "./features/links.js";
import { onPathChanged, parseDocChanged, watchWindowForChanges } from "./features/live-reload.js";
import { initShortcuts } from "./features/shortcuts.js";
import { initContextMenu } from "./features/context-menu.js";
import { initTabbarInput } from "./features/tabbar-input.js";
import { initWindowControls } from "./features/window-controls.js";

async function consumePendingPaths() {
  try {
    const pending = await takePendingPaths();
    if (pending?.length) await openMany(pending);
  } catch (e) {
    showError(String(e));
  }
}

async function boot() {
  try {
    state.prefs = (await getPrefs()) || state.prefs;
  } catch (_) {
    /* defaults */
  }
  state.prefs.sidebarWidth = clampSidebarWidth(state.prefs.sidebarWidth ?? DEFAULT_SIDEBAR_WIDTH);
  state.prefs.recent = Array.isArray(state.prefs.recent) ? state.prefs.recent : [];
  applyPrefs();
  updateStatus();
  renderRecent();

  await onDocChanged((ev) => {
    const change = parseDocChanged(ev.payload);
    if (!change?.path) return;
    onPathChanged(change.path, change.missing);
  });

  await onOpenPaths(() => {
    void consumePendingPaths();
  });

  watchWindowForChanges();

  try {
    const pending = await takePendingPaths();
    if (pending?.length) {
      await openMany(pending);
      return;
    }
  } catch (e) {
    showError(String(e));
  }

  showEmpty();
}

initRecent({ open: (path) => openPath(path) });
initDiagrams({ onViewChange: refreshFind });
initDiagramDialog();
initMediaEmbeds();
initLinks();
initContextMenu();
initWindowControls();
initTabbarInput();
initOpenButtons();
initBanner();
initOutlineToggle();
initFind();
initThemeToggle();
initZoom();
initShortcuts();
initResizer();
initScrollSpy();
initWindowResize();

boot();
