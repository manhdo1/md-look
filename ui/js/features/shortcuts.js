import { ZOOM_STEP } from "../core/constants.js";
import { dialog, findBar } from "../core/dom.js";
import { state } from "../core/state.js";
import { closeFind, openFind } from "../views/find.js";
import { setZoom } from "../views/layout.js";
import { closeTab, cycleTab, goToTabIndex, pickAndOpen, reopenClosedTab } from "./documents.js";
import { reloadKeepingScroll } from "./live-reload.js";

export function initShortcuts() {
  window.addEventListener("keydown", (ev) => {
    if (dialog.open) return;
    const mod = ev.ctrlKey || ev.metaKey;
    if (ev.key === "F5" || (mod && ev.key.toLowerCase() === "r")) {
      ev.preventDefault();
      if (!ev.repeat) void reloadKeepingScroll(undefined, { toast: true });
      return;
    }
    if (mod && ev.key.toLowerCase() === "o") {
      ev.preventDefault();
      pickAndOpen();
    } else if (mod && ev.key.toLowerCase() === "f") {
      ev.preventDefault();
      openFind();
    } else if (mod && ev.key.toLowerCase() === "w") {
      ev.preventDefault();
      if (state.activeId) void closeTab(state.activeId);
    } else if (mod && ev.key.toLowerCase() === "t" && ev.shiftKey) {
      ev.preventDefault();
      void reopenClosedTab();
    } else if (mod && (ev.key === "Tab" || ev.key === "PageDown" || ev.key === "PageUp")) {
      ev.preventDefault();
      cycleTab(ev.key === "PageUp" || (ev.key === "Tab" && ev.shiftKey) ? -1 : 1);
    } else if (mod && ev.key >= "1" && ev.key <= "9") {
      ev.preventDefault();
      if (ev.key === "9") goToTabIndex(state.order.length - 1);
      else goToTabIndex(Number(ev.key) - 1);
    } else if (ev.key === "Escape" && findBar.classList.contains("visible")) {
      closeFind();
    } else if (mod && (ev.key === "=" || ev.key === "+")) {
      ev.preventDefault();
      setZoom((state.prefs.zoom || 1) + ZOOM_STEP);
    } else if (mod && ev.key === "-") {
      ev.preventDefault();
      setZoom((state.prefs.zoom || 1) - ZOOM_STEP);
    } else if (mod && ev.key === "0") {
      ev.preventDefault();
      setZoom(1);
    }
  });
}
