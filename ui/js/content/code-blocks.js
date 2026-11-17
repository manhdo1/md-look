import { HLJS_CACHE_MAX } from "../core/constants.js";
import { previewScroll } from "../core/dom.js";
import { LruCache } from "../core/lru.js";
import { state } from "../core/state.js";
import { copyButton } from "../widgets/clipboard.js";

export function isMermaidBlock(code) {
  return [...code.classList].some((c) => {
    const l = c.toLowerCase();
    return l === "language-mermaid" || l === "mermaid";
  });
}

function codeLanguage(code) {
  const cls = [...code.classList].find((c) => c.startsWith("language-"));
  return cls ? cls.slice("language-".length) : "";
}

/** Highlighted markup per class list + source, most recently used last. */
const hljsCache = new LruCache(HLJS_CACHE_MAX);
/** @type {Set<HTMLElement>} */
const pendingCode = new Set();
/** @type {IntersectionObserver | null} */
let codeObserver = null;

function cacheKey(code) {
  return `${code.className}\n${code.textContent ?? ""}`;
}

/** Live reload re-renders the whole article; reuse markup for blocks that did not change. */
function applyCachedHighlight(code) {
  const cached = hljsCache.get(cacheKey(code));
  if (!cached) return false;
  code.className = cached.className;
  code.innerHTML = cached.html;
  code.dataset.highlighted = "yes";
  return true;
}

function highlightCode(code) {
  if (!window.hljs || code.dataset.highlighted === "yes") return;
  if (applyCachedHighlight(code)) return;
  const key = cacheKey(code);
  try {
    window.hljs.highlightElement(code);
  } catch (_) {
    /* unknown language */
  }
  hljsCache.set(key, { className: code.className, html: code.innerHTML });
}

function observer() {
  if (codeObserver) return codeObserver;
  codeObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const code = entry.target;
        codeObserver.unobserve(code);
        pendingCode.delete(code);
        highlightCode(code);
      }
    },
    { root: previewScroll, rootMargin: "100% 0px" }
  );
  return codeObserver;
}

/** Highlight on approach; unlabeled blocks stay plain because auto-detection is ~6x slower. */
function scheduleHighlight(code) {
  if (!window.hljs || !codeLanguage(code)) return;
  if (applyCachedHighlight(code)) return;
  pendingCode.add(code);
  observer().observe(code);
}

export function enhanceCodeBlocks() {
  state.article.querySelectorAll("pre > code").forEach((code) => {
    if (isMermaidBlock(code)) return;
    const pre = code.parentElement;
    scheduleHighlight(code);
    const lang = codeLanguage(code);
    const wrap = document.createElement("div");
    wrap.className = "code-block" + (lang ? " has-lang" : "");
    const head = document.createElement("div");
    head.className = "block-head";
    const langEl = document.createElement("span");
    langEl.className = "block-lang";
    langEl.textContent = lang;
    head.append(langEl, copyButton(() => code.textContent ?? ""));
    pre.replaceWith(wrap);
    wrap.append(head, pre);
  });
}

/** Highlight every pending block under `root` now; find ranges break if text nodes change later. */
export function flushCodeHighlights(root) {
  for (const code of pendingCode) {
    if (!root?.contains(code)) continue;
    codeObserver?.unobserve(code);
    pendingCode.delete(code);
    highlightCode(code);
  }
}

/** Stop observing code blocks of an article that is being replaced, evicted, or closed. */
export function releaseCodeBlocks(root) {
  for (const code of pendingCode) {
    if (!root?.contains(code)) continue;
    codeObserver?.unobserve(code);
    pendingCode.delete(code);
  }
}
