import { state } from "../core/state.js";

const EMBED_HOST_RE =
  /^https:\/\/(www\.)?(youtube-nocookie\.com|youtube\.com)\/embed\/|^https:\/\/player\.vimeo\.com\/video\//i;

const IFRAME_SANDBOX =
  "allow-scripts allow-same-origin allow-presentation allow-popups";

function isAllowedEmbedSrc(src) {
  return Boolean(src) && EMBED_HOST_RE.test(src);
}

function createFacade(src, title) {
  const wrap = document.createElement("div");
  wrap.className = "media-embed media-embed--lazy";
  wrap.dataset.embedSrc = src;
  if (title) {
    wrap.dataset.embedTitle = title;
    wrap.title = title;
  }
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "media-embed__load";
  btn.textContent = "Load video";
  wrap.appendChild(btn);
  return wrap;
}

function loadEmbed(wrap) {
  const src = wrap.dataset.embedSrc;
  if (!src || !isAllowedEmbedSrc(src)) return;
  if (wrap.querySelector("iframe")) return;

  const iframe = document.createElement("iframe");
  iframe.src = src;
  iframe.allowFullscreen = true;
  iframe.loading = "lazy";
  iframe.referrerPolicy = "strict-origin-when-cross-origin";
  iframe.setAttribute("sandbox", IFRAME_SANDBOX);
  const title = wrap.dataset.embedTitle || wrap.title;
  if (title) iframe.title = title;

  wrap.classList.remove("media-embed--lazy");
  wrap.replaceChildren(iframe);
}

/** Turn sanitized YouTube/Vimeo iframes into click-to-load facades. */
function demoteEagerIframes(root) {
  root.querySelectorAll("iframe").forEach((iframe) => {
    const src = iframe.getAttribute("src") || "";
    if (!isAllowedEmbedSrc(src)) return;
    const title = iframe.getAttribute("title") || "";
    const facade = createFacade(src, title);
    const host = iframe.closest(".media-embed");
    if (host) {
      host.replaceWith(facade);
    } else {
      iframe.replaceWith(facade);
    }
  });
}

/**
 * Prepare lazy embeds in the article: demote any eager iframes, ensure facades
 * are ready for the delegated click handler.
 */
export function enhanceMediaEmbeds(root = state.article) {
  if (!root) return;
  demoteEagerIframes(root);
}

export function initMediaEmbeds() {
  document.addEventListener(
    "click",
    (ev) => {
      const btn = ev.target.closest?.(".media-embed__load");
      if (!btn) return;
      const wrap = btn.closest(".media-embed--lazy");
      if (!wrap || !state.article?.contains(wrap)) return;
      ev.preventDefault();
      loadEmbed(wrap);
    },
    true
  );
}
