import { main, outlineEmpty, outlineList, previewScroll, sectionEl } from "../core/dom.js";
import { state } from "../core/state.js";
import { applyPrefs, isNarrow } from "./layout.js";
import { updateProgress } from "./status.js";

let activeHeadingId = null;
let scrollRaf = 0;
let resizeRaf = 0;
/** Heading offsets inside the preview, in outline order; null until measured. */
let headingTops = null;
/** Images, diagrams, zoom, and width changes all resize the article and move headings. */
const articleSizeObserver = new ResizeObserver(() => {
  headingTops = null;
});

function measureHeadingTops() {
  const rootTop = previewScroll.getBoundingClientRect().top - previewScroll.scrollTop;
  return state.outline.map((item) => {
    const el = document.getElementById(item.id);
    return el ? el.getBoundingClientRect().top - rootTop : Infinity;
  });
}

export function renderOutline(entries) {
  state.outline = entries || [];
  const { outline } = state;
  headingTops = null;
  articleSizeObserver.disconnect();
  articleSizeObserver.observe(state.article);
  outlineList.innerHTML = "";
  outlineEmpty.hidden = outline.length > 0 || state.article.hidden;
  const minLevel = outline.reduce((m, e) => Math.min(m, e.level), 6);
  for (const entry of outline) {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = entry.title;
    btn.title = entry.title;
    btn.dataset.depth = String(Math.min(3, entry.level - minLevel));
    btn.dataset.id = entry.id;
    btn.addEventListener("click", () => {
      const el = document.getElementById(entry.id);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
      if (isNarrow() && main.classList.contains("outline-user-open")) {
        main.classList.remove("outline-user-open");
        applyPrefs();
      }
    });
    li.appendChild(btn);
    outlineList.appendChild(li);
  }
  activeHeadingId = null;
  updateActiveHeading();
}

/**
 * Scroll-spy: last heading whose top has crossed a probe line near the top of
 * the viewport. At document end, force the last entry so short trailing
 * sections still light up.
 */
export function updateActiveHeading() {
  const { outline } = state;
  if (!outline.length || !outlineList.childElementCount || state.article.hidden) {
    activeHeadingId = null;
    sectionEl.textContent = "";
    return;
  }

  const { scrollTop, clientHeight, scrollHeight } = previewScroll;
  const atBottom = scrollTop + clientHeight >= scrollHeight - 12;

  let activeIdx = 0;
  if (atBottom) {
    activeIdx = outline.length - 1;
  } else {
    const probe = scrollTop + Math.min(96, Math.max(32, clientHeight * 0.2));
    if (!headingTops || headingTops.length !== outline.length) headingTops = measureHeadingTops();
    headingTops.forEach((top, i) => {
      if (top <= probe) activeIdx = i;
    });
  }

  const activeId = outline[activeIdx].id;
  if (activeId === activeHeadingId) return;
  activeHeadingId = activeId;
  const items = [...outlineList.children];
  const count = document.createElement("span");
  count.className = "status-count";
  count.textContent = `${activeIdx + 1} / ${outline.length}`;
  sectionEl.replaceChildren(count, outline[activeIdx].title);
  sectionEl.title = outline[activeIdx].title;

  items.forEach((li, i) => {
    li.classList.toggle("passed", i < activeIdx);
    li.classList.toggle("current", i === activeIdx);
  });
  items[activeIdx]?.scrollIntoView({ block: "nearest", inline: "nearest" });
}

/** Re-sync the outline highlight and reading progress on the next frame. */
export function refreshScrollIndicators() {
  requestAnimationFrame(() => {
    updateActiveHeading();
    updateProgress();
  });
}

function onPreviewScroll() {
  if (scrollRaf) return;
  scrollRaf = requestAnimationFrame(() => {
    scrollRaf = 0;
    updateActiveHeading();
    updateProgress();
  });
}

export function initScrollSpy() {
  previewScroll.addEventListener("scroll", onPreviewScroll, { passive: true });
}

/** Re-apply the narrow-window outline layout and re-sync indicators on resize. */
export function initWindowResize() {
  window.addEventListener("resize", () => {
    if (resizeRaf) return;
    resizeRaf = requestAnimationFrame(() => {
      resizeRaf = 0;
      applyPrefs();
      updateActiveHeading();
      updateProgress();
    });
  });
}
