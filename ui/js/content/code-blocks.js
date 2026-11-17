import { HLJS_CACHE_MAX } from "../core/constants.js";
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

/** Live reload re-renders the whole article; reuse markup for blocks that did not change. */
function highlightCode(code) {
  if (!window.hljs) return;
  const key = `${code.className}\n${code.textContent ?? ""}`;
  const cached = hljsCache.get(key);
  if (cached) {
    code.className = cached.className;
    code.innerHTML = cached.html;
    code.dataset.highlighted = "yes";
    return;
  }
  try {
    window.hljs.highlightElement(code);
  } catch (_) {
    /* unknown language */
  }
  hljsCache.set(key, { className: code.className, html: code.innerHTML });
}

export function enhanceCodeBlocks() {
  state.article.querySelectorAll("pre > code").forEach((code) => {
    if (isMermaidBlock(code)) return;
    const pre = code.parentElement;
    highlightCode(code);
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
