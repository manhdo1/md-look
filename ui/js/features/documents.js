import { MAX_CLOSED_STACK, MAX_LIVE_TABS, MAX_RECENT } from "../core/constants.js";
import {
  $,
  createArticleEl,
  docTitle,
  empty,
  outlineEmpty,
  outlineList,
  pathDir,
  pathLabel,
  previewScroll,
  tabbar,
} from "../core/dom.js";
import { closeFile, openFile, pickFiles, reloadFile, setActive } from "../core/ipc.js";
import { basename, dirname, samePath } from "../core/paths.js";
import { activeTab, findTabByPath, state, touchLru } from "../core/state.js";
import { enhanceCodeBlocks, releaseCodeBlocks } from "../content/code-blocks.js";
import { diagramsIdle, prepareDiagrams, releaseDiagrams } from "../content/diagrams.js";
import { enhanceMediaEmbeds } from "../content/media-embeds.js";
import { clearDeletedBanner, isMissingFileError, showDeletedBanner, showError } from "../widgets/banner.js";
import { clearFind, refreshFind } from "../views/find.js";
import { refreshScrollIndicators, renderOutline } from "../views/outline.js";
import { renderRecent } from "../views/recent.js";
import { updateStatus } from "../views/status.js";
import {
  clearTabChanged,
  markBackgroundChanged,
  refreshTabSelection,
  renderTabbar,
} from "../views/tabbar.js";
import { withTabReload } from "./reload-queue.js";

function attachArticle(tab) {
  empty.classList.remove("visible");
  empty.hidden = true;
  if (state.article && state.article !== tab.el && state.article.parentNode === previewScroll) {
    state.article.remove();
  }
  state.article = tab.el;
  state.article.hidden = false;
  if (!state.article.isConnected) {
    previewScroll.appendChild(state.article);
  }
}

/** Pause media so background tabs do not keep playing after the article leaves the DOM. */
function pauseArticleMedia(el) {
  if (!el) return;
  for (const media of el.querySelectorAll("video, audio")) {
    try {
      media.pause();
    } catch (_) {
      /* ignore */
    }
  }
}

/** Save the active tab's scroll position and take its article out of the preview. */
function detachActiveArticle() {
  const tab = activeTab();
  if (tab?.el?.isConnected) {
    pauseArticleMedia(tab.el);
    tab.scrollTop = previewScroll.scrollTop;
    tab.el.remove();
  }
}

function setRefreshEnabled(enabled) {
  const btn = $("btn-refresh");
  if (btn) btn.disabled = !enabled;
}

function updateChromeForTab(tab) {
  state.currentPath = tab?.path || "";
  state.currentWordCount = tab ? Number(tab.wordCount) || 0 : 0;
  state.currentLossyDecode = Boolean(tab?.lossyDecode);
  state.outline = tab?.outline || [];
  pathLabel.textContent = tab ? basename(tab.path) || tab.title || "" : "";
  pathDir.textContent = tab ? dirname(tab.path) : "";
  docTitle.title = tab?.path || "";
  document.title = tab
    ? `${tab.title || basename(tab.path) || "markdown-look"} — markdown-look`
    : "markdown-look";
  setRefreshEnabled(Boolean(tab));
  updateStatus();
  void setActive(tab ? tab.title || basename(tab.path) : null).catch(() => {});
}

function evictLiveTabsIfNeeded() {
  const { tabs, order } = state;
  const live = order.filter((id) => tabs.get(id)?.el);
  if (live.length <= MAX_LIVE_TABS) return;
  const victims = state.lruOrder.filter((id) => id !== state.activeId && tabs.get(id)?.el);
  while (order.filter((id) => tabs.get(id)?.el).length > MAX_LIVE_TABS && victims.length) {
    const id = victims.shift();
    const tab = tabs.get(id);
    if (!tab?.el) continue;
    releaseDiagrams(tab.el);
    releaseCodeBlocks(tab.el);
    tab.el = null;
    tab.stale = true;
  }
}

function fillArticleFromDoc(tab, doc) {
  if (!tab.el) tab.el = createArticleEl();
  releaseDiagrams(tab.el);
  releaseCodeBlocks(tab.el);
  state.article = tab.el;
  state.article.hidden = false;
  state.article.innerHTML = doc.html || "";
  tab.path = doc.path || tab.path;
  tab.title = doc.title || basename(tab.path);
  tab.outline = doc.outline || [];
  tab.wordCount = Number(doc.word_count) || 0;
  tab.lossyDecode = Boolean(doc.lossy_decode);
  tab.stale = false;
  prepareDiagrams();
  enhanceCodeBlocks();
  enhanceMediaEmbeds();
}

export async function activateTab(id, { restoreScroll = true } = {}) {
  const { tabs, reloads } = state;
  if (!tabs.has(id)) return;
  const next = tabs.get(id);
  const prev = activeTab();
  if (prev === next && next.el?.isConnected && !next.stale && !next.missing) return;

  if (prev && prev.id !== id) {
    clearFind();
    detachActiveArticle();
  }

  state.activeId = id;
  touchLru(id);

  if (prev && prev !== next && prev.missing) {
    markBackgroundChanged(prev);
    clearDeletedBanner();
  }

  let keepError = false;
  if (!next.el || next.stale || next.missing) {
    const joined = reloads.get(id);
    if (joined) await joined.done;

    if (!tabs.has(id) || state.activeId !== id) return;

    if (!next.el || next.stale || next.missing) {
      let failed = null;
      await withTabReload(next, { toast: false }, async () => {
        if (!tabs.has(id) || state.activeId !== id) {
          next.stale = true;
          return;
        }
        try {
          const doc = await reloadFile(next.path);
          if (!tabs.has(id) || state.activeId !== id) {
            next.stale = true;
            markBackgroundChanged(next);
            return;
          }
          failed = null;
          const shown = state.article;
          fillArticleFromDoc(next, doc);
          if (state.activeId !== id) {
            state.article = shown;
            next.stale = true;
            return;
          }
          next.missing = false;
          clearTabChanged(next);
          clearDeletedBanner();
        } catch (e) {
          if (!tabs.has(id)) return;
          if (isMissingFileError(e)) {
            failed = null;
            next.missing = true;
            next.stale = true;
            return;
          }
          failed = e;
        }
      });

      if (!tabs.has(id) || state.activeId !== id) return;

      if (failed) {
        showError(String(failed));
        keepError = true;
        if (prev && prev !== next && tabs.has(prev.id)) {
          state.activeId = null;
          await activateTab(prev.id);
          return;
        }
        if (!next.el) return;
      } else if (next.missing) {
        if (!next.el) next.el = createArticleEl();
        showDeletedBanner({ force: true });
      }
    }
  }

  attachArticle(next);
  updateChromeForTab(next);
  renderOutline(next.outline || []);
  if (!keepError) {
    if (next.missing) showDeletedBanner({ force: true });
    else clearDeletedBanner();
  }
  refreshTabSelection();
  if (tabs.size >= 2) {
    if (tabbar.hidden || tabbar.childElementCount !== tabs.size) renderTabbar();
    else refreshTabSelection();
  } else {
    renderTabbar();
  }

  if (restoreScroll) {
    previewScroll.scrollTop = next.scrollTop || 0;
  }

  refreshFind();

  refreshScrollIndicators();

  evictLiveTabsIfNeeded();
}

export async function closeTab(id) {
  const { tabs, closedStack } = state;
  const tab = tabs.get(id);
  if (!tab) return;

  const idx = state.order.indexOf(id);
  closedStack.unshift(tab.path);
  if (closedStack.length > MAX_CLOSED_STACK) closedStack.length = MAX_CLOSED_STACK;

  try {
    await closeFile(tab.path);
  } catch (e) {
    console.error(e);
  }

  if (tab.el?.isConnected) tab.el.remove();
  releaseDiagrams(tab.el);
  releaseCodeBlocks(tab.el);
  tabs.delete(id);
  state.order = state.order.filter((x) => x !== id);
  state.lruOrder = state.lruOrder.filter((x) => x !== id);

  if (!tabs.size) {
    state.activeId = null;
    showEmpty();
    renderTabbar();
    return;
  }

  if (state.activeId === id) {
    const nextId = state.order[idx] || state.order[idx - 1] || state.order[0];
    state.activeId = null;
    await activateTab(nextId);
  } else {
    renderTabbar();
  }
}

export function cycleTab(dir) {
  const { order, activeId } = state;
  if (order.length < 2 || !activeId) return;
  const i = order.indexOf(activeId);
  const next = order[(i + dir + order.length) % order.length];
  void activateTab(next);
}

export function goToTabIndex(n) {
  const { order } = state;
  if (!order.length) return;
  const id = n >= order.length ? order[order.length - 1] : order[n];
  if (id) void activateTab(id);
}

export async function reopenClosedTab() {
  const path = state.closedStack.shift();
  if (path) await openPath(path);
}

export function showEmpty() {
  if (state.article?.isConnected) state.article.remove();
  state.article = createArticleEl();
  state.article.hidden = true;
  empty.hidden = false;
  empty.classList.add("visible");
  if (!empty.isConnected) previewScroll.appendChild(empty);
  outlineList.innerHTML = "";
  outlineEmpty.hidden = true;
  pathLabel.textContent = "";
  pathDir.textContent = "";
  docTitle.title = "";
  state.currentPath = "";
  state.currentWordCount = 0;
  state.currentLossyDecode = false;
  state.outline = [];
  setRefreshEnabled(false);
  updateStatus();
  void setActive(null).catch(() => {});
  renderRecent();
}

/** Mirror the backend's recent list so a later `set_prefs` does not overwrite it with a stale copy. */
function rememberRecent(path) {
  if (!path) return;
  state.prefs.recent = [
    path,
    ...(state.prefs.recent || []).filter((p) => !samePath(p, path)),
  ].slice(0, MAX_RECENT);
}

export function applyDocToActiveTab(doc) {
  const tab = activeTab();
  if (!tab) return Promise.resolve();
  showError(null);
  fillArticleFromDoc(tab, doc);
  attachArticle(tab);
  updateChromeForTab(tab);
  renderOutline(tab.outline);
  clearFind();
  rememberRecent(tab.path);

  // Two frames: the observer reports new diagrams after the first layout.
  const nextFrame = () => new Promise(requestAnimationFrame);
  return nextFrame()
    .then(nextFrame)
    .then(diagramsIdle)
    .then(() => {
      refreshScrollIndicators();
    });
}

export async function openPath(path, force = false, { activate = true } = {}) {
  const existing = findTabByPath(path);
  if (existing) {
    if (activate) await activateTab(existing.id);
    return { path: existing.path, title: existing.title };
  }

  try {
    const doc = await openFile(path, force);
    const id = `t${state.nextTabId++}`;
    const tab = {
      id,
      path: doc.path || path,
      title: doc.title || basename(doc.path || path),
      el: createArticleEl(),
      outline: doc.outline || [],
      wordCount: Number(doc.word_count) || 0,
      lossyDecode: Boolean(doc.lossy_decode),
      scrollTop: 0,
      force: !!force,
      stale: false,
      changed: false,
      missing: false,
    };

    const insertAt = state.activeId ? state.order.indexOf(state.activeId) + 1 : state.order.length;
    state.order.splice(insertAt, 0, id);
    state.tabs.set(id, tab);
    touchLru(id);

    const keepArticle = state.article;
    fillArticleFromDoc(tab, doc);
    rememberRecent(tab.path);

    if (activate) {
      detachActiveArticle();
      state.activeId = id;
      attachArticle(tab);
      updateChromeForTab(tab);
      renderOutline(tab.outline);
      clearFind();
      previewScroll.scrollTop = 0;
      renderTabbar();
      renderRecent();
      evictLiveTabsIfNeeded();
      refreshScrollIndicators();
    } else {
      state.article = activeTab()?.el || keepArticle;
      renderTabbar();
    }
    return doc;
  } catch (e) {
    const msg = String(e);
    if (msg.includes("over 50 MB")) {
      if (confirm(`${msg}\n\nLoad anyway?`)) {
        return openPath(path, true, { activate });
      }
    }
    showError(msg);
    throw e;
  }
}

export async function openMany(paths) {
  const list = (paths || []).filter(Boolean);
  if (!list.length) return;
  let lastPath = null;
  for (const path of list) {
    try {
      const doc = await openPath(path, false, { activate: false });
      // Prefer normalized doc.path — argv/UNC forms can differ (\\server vs \\?\UNC\server).
      lastPath = doc?.path || path;
    } catch (_) {
      /* error already shown */
    }
  }
  if (lastPath) {
    const tab = findTabByPath(lastPath);
    if (tab) await activateTab(tab.id);
  }
}

export async function pickAndOpen() {
  try {
    const paths = await pickFiles();
    if (paths?.length) await openMany(paths);
  } catch (e) {
    showError(String(e));
  }
}

export function initOpenButtons() {
  $("btn-open").addEventListener("click", pickAndOpen);
  $("btn-open-empty").addEventListener("click", pickAndOpen);
}
