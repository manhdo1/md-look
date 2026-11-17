import { DELETED_FILE_MSG } from "../core/constants.js";
import { errorBanner, errorClose, errorText } from "../core/dom.js";
import { state } from "../core/state.js";

export function showError(msg) {
  errorText.textContent = msg || "";
  errorText.removeAttribute("lang");
  errorBanner.classList.remove("warning");
  errorBanner.setAttribute("role", "alert");
  errorClose.setAttribute("aria-label", "Dismiss error");
  errorBanner.classList.toggle("visible", Boolean(msg));
}

export function showDeletedBanner({ force = false } = {}) {
  if (!force && state.deletedBannerMutedFor === state.activeId) return;
  if (force) state.deletedBannerMutedFor = null;
  errorBanner.classList.add("warning");
  errorBanner.setAttribute("role", "status");
  errorClose.setAttribute("aria-label", "Dismiss warning");
  errorText.lang = "vi";
  if (errorText.textContent !== DELETED_FILE_MSG) errorText.textContent = DELETED_FILE_MSG;
  errorBanner.classList.add("visible");
}

export function clearDeletedBanner() {
  if (!errorBanner.classList.contains("warning")) return;
  showError(null);
}

export function isMissingFileError(err) {
  const detail = err && typeof err === "object" && err.message ? err.message : err;
  const msg = String(detail).toLowerCase();
  return msg.includes("not found") || msg.includes("missing");
}

export function initBanner() {
  errorClose.addEventListener("click", () => {
    if (errorBanner.classList.contains("warning")) state.deletedBannerMutedFor = state.activeId;
    showError(null);
  });
}
