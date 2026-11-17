import { $ } from "./dom.js";
import { DEFAULT_SIDEBAR_WIDTH } from "./constants.js";
import { samePath } from "./paths.js";

/** Shared mutable app state; ESM bindings are read-only, so modules mutate this object. */
export const state = {
  /** The article element currently shown in the preview. */
  article: $("article"),
  prefs: {
    theme: "light",
    zoom: 1,
    outlineOpen: true,
    sidebarWidth: DEFAULT_SIDEBAR_WIDTH,
    recent: [],
  },
  outline: [],
  currentPath: "",
  currentWordCount: 0,
  currentLossyDecode: false,
  findMatches: [],
  findIndex: -1,
  /** @type {Map<string, {again: boolean, toast: boolean, done: Promise<void>}>} */
  reloads: new Map(),
  toastAfterDialog: false,
  /** Tab id whose deleted-file banner the reader dismissed, so the poll does not reopen it. */
  deletedBannerMutedFor: null,
  /** @type {Map<string, object>} */
  tabs: new Map(),
  /** @type {string[]} */
  order: [],
  /** @type {string | null} */
  activeId: null,
  nextTabId: 1,
  /** @type {string[]} */
  closedStack: [],
  /** @type {string[]} */
  lruOrder: [],
};

export function findTabByPath(path) {
  for (const tab of state.tabs.values()) {
    if (samePath(tab.path, path)) return tab;
  }
  return null;
}

export function activeTab() {
  return state.activeId ? state.tabs.get(state.activeId) || null : null;
}

export function touchLru(id) {
  state.lruOrder = state.lruOrder.filter((x) => x !== id);
  state.lruOrder.push(id);
}
