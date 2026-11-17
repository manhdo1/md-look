import { tabbar } from "../core/dom.js";
import { state } from "../core/state.js";
import { activateTab, closeTab, goToTabIndex } from "./documents.js";

/** Mouse, wheel, and keyboard handling on the tab strip. */
export function initTabbarInput() {
  tabbar.addEventListener("click", (ev) => {
    const closeBtn = ev.target.closest(".tab-close");
    if (closeBtn) {
      ev.preventDefault();
      ev.stopPropagation();
      const id = closeBtn.closest(".tab")?.dataset?.tabId;
      if (id) void closeTab(id);
      return;
    }
    const tabEl = ev.target.closest(".tab");
    if (tabEl?.dataset?.tabId) void activateTab(tabEl.dataset.tabId);
  });

  tabbar.addEventListener("auxclick", (ev) => {
    if (ev.button !== 1) return;
    const tabEl = ev.target.closest(".tab");
    if (!tabEl?.dataset?.tabId) return;
    ev.preventDefault();
    void closeTab(tabEl.dataset.tabId);
  });

  tabbar.addEventListener(
    "wheel",
    (ev) => {
      if (Math.abs(ev.deltaY) > Math.abs(ev.deltaX)) {
        tabbar.scrollLeft += ev.deltaY;
        ev.preventDefault();
      }
    },
    { passive: false }
  );

  tabbar.addEventListener("keydown", (ev) => {
    const { order, activeId } = state;
    if (!order.length) return;
    const i = order.indexOf(activeId);
    if (ev.key === "ArrowRight") {
      ev.preventDefault();
      goToTabIndex((i + 1) % order.length);
      tabbar.querySelector(`.tab[data-tab-id="${order[(i + 1) % order.length]}"]`)?.focus();
    } else if (ev.key === "ArrowLeft") {
      ev.preventDefault();
      const next = (i - 1 + order.length) % order.length;
      goToTabIndex(next);
      tabbar.querySelector(`.tab[data-tab-id="${order[next]}"]`)?.focus();
    } else if (ev.key === "Delete" || ev.key === "Backspace") {
      ev.preventDefault();
      if (activeId) void closeTab(activeId);
    }
  });
}
