import { CHANGE_POLL_MS } from "../core/constants.js";
import { previewScroll } from "../core/dom.js";
import { checkChangedPaths, reloadFile } from "../core/ipc.js";
import { activeTab, findTabByPath, state } from "../core/state.js";
import { isMissingFileError, showDeletedBanner, showError } from "../widgets/banner.js";
import { updateActiveHeading } from "../views/outline.js";
import { updateProgress } from "../views/status.js";
import { clearTabChanged, markBackgroundChanged } from "../views/tabbar.js";
import { showUpdatedToast } from "../widgets/toast.js";
import { applyDocToActiveTab } from "./documents.js";
import { withTabReload } from "./reload-queue.js";

let changePollTimer = 0;
/** @type {{again: boolean, all: boolean, promise: Promise<void>} | null} */
let changeCheck = null;

function captureScrollAnchor() {
  const rootRect = previewScroll.getBoundingClientRect();
  const headings = state.article.querySelectorAll("h1[id], h2[id], h3[id], h4[id], h5[id], h6[id]");
  let best = null;
  for (const el of headings) {
    const rect = el.getBoundingClientRect();
    if (rect.bottom < rootRect.top) continue;
    if (rect.top <= rootRect.top + 8) {
      best = { id: el.id, offset: rect.top - rootRect.top };
    } else if (!best) {
      best = { id: el.id, offset: rect.top - rootRect.top };
      break;
    } else {
      break;
    }
  }
  if (best) return best;
  return { id: null, offset: previewScroll.scrollTop };
}

function restoreScrollAnchor(anchor) {
  if (anchor.id) {
    const el = document.getElementById(anchor.id);
    if (el) {
      const rootRect = previewScroll.getBoundingClientRect();
      const rect = el.getBoundingClientRect();
      previewScroll.scrollTop += rect.top - rootRect.top - (anchor.offset || 0);
    } else {
      previewScroll.scrollTop = anchor.offset || 0;
    }
  } else {
    previewScroll.scrollTop = anchor.offset || 0;
  }
  updateActiveHeading();
  updateProgress();
}

export function parseDocChanged(payload) {
  if (typeof payload === "string") return { path: payload, missing: false };
  if (payload && typeof payload.path === "string") {
    return { path: payload.path, missing: payload.missing === true };
  }
  return null;
}

export function onPathChanged(path, missing) {
  const tab = findTabByPath(path);
  if (!tab) return;
  if (missing) {
    const fresh = !tab.missing;
    tab.missing = true;
    tab.stale = true;
    if (fresh && state.deletedBannerMutedFor === tab.id) state.deletedBannerMutedFor = null;
    if (tab.id === state.activeId) showDeletedBanner();
    else markBackgroundChanged(tab);
    return;
  }
  if (state.deletedBannerMutedFor === tab.id) state.deletedBannerMutedFor = null;
  tab.missing = false;
  if (tab.id === state.activeId) void reloadKeepingScroll(tab.path, { toast: true });
  else markBackgroundChanged(tab);
}

export async function reloadKeepingScroll(path, { toast = false } = {}) {
  const { tabs } = state;
  const tab = path ? findTabByPath(path) : activeTab();
  if (!tab) return;

  if (tab.id !== state.activeId) {
    markBackgroundChanged(tab);
    return;
  }

  await withTabReload(tab, { toast }, async ({ toast: showToast }) => {
    if (!tabs.has(tab.id) || tab.id !== state.activeId) {
      tab.stale = true;
      return;
    }
    const anchor = captureScrollAnchor();
    try {
      const doc = await reloadFile(tab.path);
      if (!tabs.has(tab.id)) return;
      if (tab.id !== state.activeId) {
        tab.stale = true;
        markBackgroundChanged(tab);
        return;
      }
      tab.missing = false;
      const rendered = applyDocToActiveTab(doc);
      clearTabChanged(tab);
      requestAnimationFrame(() => restoreScrollAnchor(anchor));
      await rendered;
      requestAnimationFrame(() => restoreScrollAnchor(anchor));
      if (showToast) showUpdatedToast();
    } catch (e) {
      if (!tabs.has(tab.id)) return;
      if (isMissingFileError(e)) {
        tab.missing = true;
        tab.stale = true;
        if (tab.id === state.activeId) showDeletedBanner({ force: true });
        else markBackgroundChanged(tab);
        return;
      }
      if (tab.id === state.activeId) showError(String(e));
    }
  });
}

function startChangePoll() {
  if (changePollTimer) return;
  changePollTimer = setInterval(() => {
    if (document.hidden) return;
    void checkChanged({ all: false });
  }, CHANGE_POLL_MS);
}

function stopChangePoll() {
  if (!changePollTimer) return;
  clearInterval(changePollTimer);
  changePollTimer = 0;
}

async function checkChanged({ all }) {
  if (changeCheck) {
    changeCheck.again = true;
    changeCheck.all = changeCheck.all || all;
    return changeCheck.promise;
  }
  let resolveCheck;
  const promise = new Promise((resolve) => {
    resolveCheck = resolve;
  });
  changeCheck = { again: false, all: !!all, promise };
  try {
    do {
      const checkAll = changeCheck.all;
      changeCheck.all = false;
      changeCheck.again = false;
      const paths = [];
      if (checkAll) {
        for (const id of state.order) {
          const path = state.tabs.get(id)?.path;
          if (path) paths.push(path);
        }
      } else if (activeTab()?.path) {
        paths.push(activeTab().path);
      }
      if (!paths.length) continue;
      let changed;
      try {
        changed = await checkChangedPaths(paths);
      } catch (e) {
        console.error(e);
        continue;
      }
      if (!Array.isArray(changed)) continue;
      for (const entry of changed) {
        if (!entry || typeof entry.path !== "string") continue;
        onPathChanged(entry.path, entry.missing === true);
      }
    } while (changeCheck.again);
  } finally {
    changeCheck = null;
    resolveCheck();
  }
}

export function watchWindowForChanges() {
  window.addEventListener("focus", () => {
    void checkChanged({ all: true });
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      stopChangePoll();
      return;
    }
    void checkChanged({ all: true });
    startChangePoll();
  });
  if (!document.hidden) startChangePoll();
}
