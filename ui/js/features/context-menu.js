import { previewScroll } from "../core/dom.js";
import { showError } from "../widgets/banner.js";
import { closeTab } from "./documents.js";
import { followLink, linkHref } from "./links.js";

const MENU_ID = "app-context-menu";

/** @type {HTMLDivElement | null} */
let menuEl = null;

function ensureMenu() {
  if (menuEl) return menuEl;
  menuEl = document.createElement("div");
  menuEl.id = MENU_ID;
  menuEl.className = "ctx-menu";
  menuEl.setAttribute("role", "menu");
  menuEl.hidden = true;
  document.body.appendChild(menuEl);
  return menuEl;
}

function hideMenu() {
  if (!menuEl || menuEl.hidden) return;
  menuEl.hidden = true;
  menuEl.innerHTML = "";
}

function placeMenu(x, y) {
  const el = ensureMenu();
  el.hidden = false;
  const pad = 8;
  const { innerWidth: vw, innerHeight: vh } = window;
  const rect = el.getBoundingClientRect();
  let left = x;
  let top = y;
  if (left + rect.width > vw - pad) left = Math.max(pad, vw - rect.width - pad);
  if (top + rect.height > vh - pad) top = Math.max(pad, vh - rect.height - pad);
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
}

/**
 * @param {{ label: string, action: () => void | Promise<void> }[]} items
 * @param {number} x
 * @param {number} y
 */
function showMenu(items, x, y) {
  if (!items.length) {
    hideMenu();
    return;
  }
  const el = ensureMenu();
  el.innerHTML = "";
  for (const item of items) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "ctx-item";
    btn.setAttribute("role", "menuitem");
    btn.textContent = item.label;
    btn.addEventListener("click", (ev) => {
      ev.preventDefault();
      hideMenu();
      void Promise.resolve(item.action()).catch((e) => showError(String(e)));
    });
    el.appendChild(btn);
  }
  placeMenu(x, y);
}

async function copyPlain(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch (e) {
    showError(`Could not copy to the clipboard: ${e}`);
  }
}

function selectionInReader() {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return "";
  const text = sel.toString();
  if (!text) return "";
  const node = sel.anchorNode;
  if (!node || !previewScroll.contains(node)) return "";
  return text;
}

function buildItems(ev) {
  /** @type {{ label: string, action: () => void | Promise<void> }[]} */
  const items = [];
  const tab = ev.target.closest?.(".tab");
  if (tab?.dataset?.tabId) {
    const id = tab.dataset.tabId;
    items.push({
      label: "Close tab",
      action: () => closeTab(id),
    });
    return items;
  }

  const selected = selectionInReader();
  if (selected) {
    items.push({
      label: "Copy",
      action: () => copyPlain(selected),
    });
  }

  const anchor = ev.target.closest?.("a");
  if (anchor && previewScroll.contains(anchor)) {
    const href = linkHref(anchor);
    if (href) {
      items.push({
        label: "Open link",
        action: () => followLink(href),
      });
      items.push({
        label: "Copy link",
        action: () => copyPlain(href),
      });
    }
  }

  return items;
}

export function initContextMenu() {
  document.addEventListener("contextmenu", (ev) => {
    ev.preventDefault();
    const items = buildItems(ev);
    if (!items.length) {
      hideMenu();
      return;
    }
    showMenu(items, ev.clientX, ev.clientY);
  });

  document.addEventListener("pointerdown", (ev) => {
    if (!menuEl || menuEl.hidden) return;
    if (menuEl.contains(/** @type {Node} */ (ev.target))) return;
    hideMenu();
  });

  window.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") hideMenu();
  });

  window.addEventListener("blur", hideMenu);
  document.addEventListener("scroll", hideMenu, true);
}
