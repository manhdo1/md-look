import { docTitle, tabbar } from "../core/dom.js";
import { icon } from "../core/icons.js";
import { basename, parentBasename } from "../core/paths.js";
import { state } from "../core/state.js";

function syncMiddleChrome(showTabs) {
  tabbar.hidden = !showTabs;
  if (docTitle) docTitle.hidden = showTabs;
  document.getElementById("titlebar")?.classList.toggle("tabs-open", showTabs);
}

function basenameCounts() {
  const counts = new Map();
  for (const id of state.order) {
    const tab = state.tabs.get(id);
    if (!tab) continue;
    const name = basename(tab.path).toLowerCase();
    counts.set(name, (counts.get(name) || 0) + 1);
  }
  return counts;
}

/** Leading dot plus trailing screen-reader note, matching the order `renderTabbar` builds. */
function setChangedMarkers(el, changed) {
  el.querySelector(":scope > .tab-changed")?.remove();
  el.querySelector(":scope > .visually-hidden")?.remove();
  if (!changed) return;
  const dot = document.createElement("span");
  dot.className = "tab-changed";
  dot.setAttribute("aria-hidden", "true");
  const note = document.createElement("span");
  note.className = "visually-hidden";
  note.textContent = "Updated";
  el.prepend(dot);
  el.append(note);
}

function updateTabChanged(tab) {
  if (tabbar.hidden) return;
  const el = tabbar.querySelector(`.tab[data-tab-id="${tab.id}"]`);
  if (el) setChangedMarkers(el, tab.changed);
  else renderTabbar();
}

export function renderTabbar() {
  const { tabs, order, activeId } = state;
  const show = tabs.size >= 2;
  syncMiddleChrome(show);
  if (!show) {
    tabbar.innerHTML = "";
    return;
  }

  const counts = basenameCounts();
  const prevFocus = document.activeElement?.closest?.(".tab")?.dataset?.tabId;
  tabbar.innerHTML = "";

  for (const id of order) {
    const tab = tabs.get(id);
    if (!tab) continue;
    const name = basename(tab.path);
    const dup = (counts.get(name.toLowerCase()) || 0) > 1;
    const el = document.createElement("div");
    el.className = "tab";
    el.setAttribute("role", "tab");
    el.dataset.tabId = id;
    el.setAttribute("aria-selected", String(id === activeId));
    el.setAttribute("aria-controls", "preview-scroll");
    el.tabIndex = id === activeId ? 0 : -1;
    el.title = tab.path;

    const label = document.createElement("span");
    label.className = "tab-label";
    label.textContent = name || tab.title || "untitled";
    el.appendChild(label);

    if (dup) {
      const dir = document.createElement("span");
      dir.className = "tab-dir";
      dir.textContent = parentBasename(tab.path);
      el.appendChild(dir);
    }

    const close = document.createElement("button");
    close.type = "button";
    close.className = "tab-close";
    close.title = "Close tab";
    close.setAttribute("aria-label", `Close ${name || "tab"}`);
    close.innerHTML = icon("close");
    el.appendChild(close);

    setChangedMarkers(el, tab.changed);
    tabbar.appendChild(el);
  }

  const activeEl = tabbar.querySelector(`.tab[data-tab-id="${activeId}"]`);
  activeEl?.scrollIntoView({ inline: "nearest", block: "nearest" });
  if (prevFocus) {
    tabbar.querySelector(`.tab[data-tab-id="${prevFocus}"]`)?.focus();
  }
}

export function refreshTabSelection() {
  if (tabbar.hidden) return;
  tabbar.querySelectorAll(".tab").forEach((el) => {
    const selected = el.dataset.tabId === state.activeId;
    el.setAttribute("aria-selected", String(selected));
    el.tabIndex = selected ? 0 : -1;
  });
  tabbar
    .querySelector(`.tab[data-tab-id="${state.activeId}"]`)
    ?.scrollIntoView({ inline: "nearest", block: "nearest" });
}

export function markBackgroundChanged(tab) {
  if (!tab || !state.tabs.has(tab.id)) return;
  tab.stale = true;
  if (tab.changed) return;
  tab.changed = true;
  updateTabChanged(tab);
}

export function clearTabChanged(tab) {
  if (!tab?.changed) return;
  tab.changed = false;
  updateTabChanged(tab);
}