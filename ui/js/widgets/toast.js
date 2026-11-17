import { TOAST_MS, UPDATED_TOAST_PREFIX } from "../core/constants.js";
import { dialog, reloadToast } from "../core/dom.js";
import { state } from "../core/state.js";

let toastTimer = 0;

function formatUpdatedStamp() {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  return `${UPDATED_TOAST_PREFIX} · ${hh}:${mm}`;
}

export function showUpdatedToast() {
  if (!reloadToast) return;
  if (dialog.open) {
    state.toastAfterDialog = true;
    return;
  }
  const text = formatUpdatedStamp();
  const canNotify = typeof reloadToast.ariaNotify === "function";
  if (typeof reloadToast.showPopover === "function" && !reloadToast.matches(":popover-open")) {
    try {
      reloadToast.showPopover();
    } catch (_) {
      /* keep the in-bar fallback */
    }
  }
  reloadToast.classList.add("visible");
  if (canNotify) reloadToast.setAttribute("aria-live", "off");
  else reloadToast.setAttribute("aria-live", "polite");
  if (reloadToast.textContent === text) reloadToast.textContent = "";
  reloadToast.textContent = text;
  if (canNotify) {
    try {
      reloadToast.ariaNotify(text, { priority: "normal" });
    } catch (_) {
      reloadToast.setAttribute("aria-live", "polite");
      reloadToast.textContent = "";
      reloadToast.textContent = text;
    }
  }
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    reloadToast.classList.remove("visible");
  }, TOAST_MS);
}
