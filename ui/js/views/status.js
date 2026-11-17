import {
  main,
  previewScroll,
  progressEl,
  sectionEl,
  statusbar,
  wordCountEl,
  zoomLabel,
} from "../core/dom.js";
import { state } from "../core/state.js";

export function updateStatus() {
  zoomLabel.textContent = `${Math.round((state.prefs.zoom || 1) * 100)}%`;
  const hasDoc = Boolean(state.currentPath);
  statusbar.classList.toggle("has-doc", hasDoc);
  main.classList.toggle("no-doc", !hasDoc);
  if (hasDoc) {
    wordCountEl.textContent =
      state.currentWordCount === 1 ? "1 word" : `${state.currentWordCount.toLocaleString()} words`;
  } else {
    wordCountEl.textContent = "";
    sectionEl.textContent = "";
    progressEl.textContent = "";
  }
  updateProgress();
}

export function updateProgress() {
  if (state.article.hidden) {
    statusbar.style.setProperty("--progress", "0");
    return;
  }
  const { scrollTop, clientHeight, scrollHeight } = previewScroll;
  const max = scrollHeight - clientHeight;
  const p = max <= 0 ? 1 : Math.min(1, Math.max(0, scrollTop / max));
  statusbar.style.setProperty("--progress", p.toFixed(4));
  progressEl.textContent = `${Math.round(p * 100)}%`;
}
