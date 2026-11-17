import { FIND_DEBOUNCE_MS } from "../core/constants.js";
import { $, findBar, findCount, findInput, previewScroll } from "../core/dom.js";
import { state } from "../core/state.js";
import { flushCodeHighlights } from "../content/code-blocks.js";

let findTimer = null;

export function clearFind() {
  state.findMatches = [];
  state.findIndex = -1;
  findCount.textContent = "";
  findCount.classList.remove("none");
  if (CSS.highlights) {
    CSS.highlights.delete("md-find");
    CSS.highlights.delete("md-find-current");
  }
}

function isSearchableText(node) {
  const el = node.parentElement;
  if (!el || el.closest(".block-head, .dg-viewport, .dg-error")) return false;
  const src = el.closest(".dg-source");
  if (src && src.closest(".diagram")?.dataset.view !== "source") return false;
  return true;
}

function collectTextNodes(root) {
  const nodes = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = walker.nextNode())) {
    if (n.nodeValue && n.nodeValue.trim() && isSearchableText(n)) nodes.push(n);
  }
  return nodes;
}

export function runFind(query) {
  clearFind();
  if (!query || state.article.hidden) return;
  if (!CSS.highlights) {
    findCount.textContent = "Unavailable";
    return;
  }

  flushCodeHighlights(state.article);
  const lower = query.toLowerCase();
  const ranges = [];
  for (const node of collectTextNodes(state.article)) {
    const hay = node.nodeValue.toLowerCase();
    let from = 0;
    while (from < hay.length) {
      const idx = hay.indexOf(lower, from);
      if (idx === -1) break;
      const range = new Range();
      range.setStart(node, idx);
      range.setEnd(node, idx + query.length);
      ranges.push(range);
      from = idx + Math.max(query.length, 1);
    }
  }

  state.findMatches = ranges;
  state.findIndex = ranges.length ? 0 : -1;
  updateFindHighlight();
}

function scheduleFind(query) {
  clearTimeout(findTimer);
  findTimer = setTimeout(() => runFind(query), FIND_DEBOUNCE_MS);
}

function scrollRangeIntoView(range) {
  try {
    const rect = range.getBoundingClientRect();
    const rootRect = previewScroll.getBoundingClientRect();
    const padding = 72;
    if (rect.top < rootRect.top + padding || rect.bottom > rootRect.bottom - padding) {
      const delta = rect.top - rootRect.top - previewScroll.clientHeight / 2 + rect.height / 2;
      previewScroll.scrollBy({ top: delta, behavior: "smooth" });
    }
  } catch (_) {
    /* ignore */
  }
}

function updateFindHighlight() {
  if (!CSS.highlights) return;
  const { findMatches, findIndex } = state;
  if (!findMatches.length) {
    findCount.textContent = findInput.value ? "No results" : "";
    findCount.classList.toggle("none", Boolean(findInput.value));
    CSS.highlights.delete("md-find");
    CSS.highlights.delete("md-find-current");
    return;
  }
  findCount.classList.remove("none");
  const others = findMatches.filter((_, i) => i !== findIndex);
  CSS.highlights.set("md-find", new Highlight(...others));
  CSS.highlights.set("md-find-current", new Highlight(findMatches[findIndex]));
  findCount.textContent = `${findIndex + 1} of ${findMatches.length}`;
  scrollRangeIntoView(findMatches[findIndex]);
}

function findNext(dir = 1) {
  if (!state.findMatches.length) return;
  state.findIndex = (state.findIndex + dir + state.findMatches.length) % state.findMatches.length;
  updateFindHighlight();
}

/** Re-run the open search after the searchable content changed. */
export function refreshFind() {
  if (findBar.classList.contains("visible") && findInput.value) runFind(findInput.value);
}

export function openFind() {
  findBar.hidden = false;
  findBar.classList.add("visible");
  findInput.focus();
  findInput.select();
  if (findInput.value) runFind(findInput.value);
}

export function closeFind() {
  findBar.classList.remove("visible");
  findBar.hidden = true;
  clearFind();
}

export function initFind() {
  $("btn-find").addEventListener("click", openFind);
  $("find-close").addEventListener("click", closeFind);
  $("find-next").addEventListener("click", () => findNext(1));
  $("find-prev").addEventListener("click", () => findNext(-1));
  findInput.addEventListener("input", () => scheduleFind(findInput.value));
  findInput.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
      ev.preventDefault();
      findNext(ev.shiftKey ? -1 : 1);
    } else if (ev.key === "Escape") {
      closeFind();
    }
  });
}
