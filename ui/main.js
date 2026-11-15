/* markdown-look frontend — no Markdown parser; Rust supplies HTML + outline. */

const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;
const { openUrl } = window.__TAURI__.opener;

const article = document.getElementById("article");
const empty = document.getElementById("empty");
const outlineList = document.getElementById("outline-list");
const pathLabel = document.getElementById("path-label");
const errorBanner = document.getElementById("error-banner");
const previewScroll = document.getElementById("preview-scroll");
const main = document.getElementById("main");
const findBar = document.getElementById("find-bar");
const findInput = document.getElementById("find-input");
const findCount = document.getElementById("find-count");
const zoomLabel = document.getElementById("zoom-label");
const wordCountEl = document.getElementById("word-count");
const statusbar = document.getElementById("statusbar");
const statusHint = document.getElementById("status-hint");
const btnZoomIn = document.getElementById("btn-zoom-in");
const btnZoomOut = document.getElementById("btn-zoom-out");
const recentWrap = document.getElementById("recent");
const recentList = document.getElementById("recent-list");
const resizer = document.getElementById("resizer");
const btnOutline = document.getElementById("btn-outline");

const NARROW_BREAKPOINT = 760;
const SIDEBAR_MIN = 180;
const SIDEBAR_MAX = 400;
const FIND_DEBOUNCE_MS = 120;

let prefs = {
  theme: "light",
  zoom: 1,
  outlineOpen: true,
  sidebarWidth: 240,
  recent: [],
};
let outline = [];
let currentPath = "";
let currentWordCount = 0;
let findMatches = [];
let findIndex = -1;
let findTimer = null;
let narrowAutoCollapsed = false;
let resizing = false;
let activeHeadingId = null;
let tocScrollRaf = 0;

function basename(path) {
  const normalized = path.replace(/\\/g, "/");
  const i = normalized.lastIndexOf("/");
  return i >= 0 ? normalized.slice(i + 1) : normalized;
}

function dirname(path) {
  const normalized = path.replace(/\\/g, "/");
  const i = normalized.lastIndexOf("/");
  return i >= 0 ? normalized.slice(0, i) : "";
}

function showError(msg) {
  if (!msg) {
    errorBanner.classList.remove("visible");
    errorBanner.textContent = "";
    return;
  }
  errorBanner.textContent = msg;
  errorBanner.classList.add("visible");
}

function clampSidebarWidth(w) {
  const n = Number(w);
  if (!Number.isFinite(n)) return 240;
  return Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, Math.round(n)));
}

function applySidebarWidth() {
  const width = clampSidebarWidth(prefs.sidebarWidth);
  prefs.sidebarWidth = width;
  document.documentElement.style.setProperty("--sidebar-width", `${width}px`);
}

function isNarrow() {
  return window.innerWidth < NARROW_BREAKPOINT;
}

function applyPrefs() {
  document.documentElement.dataset.theme = prefs.theme === "dark" ? "dark" : "light";
  document.documentElement.style.setProperty("--zoom", String(prefs.zoom || 1));
  applySidebarWidth();

  const wantOpen = !!prefs.outlineOpen;
  const collapsed = !wantOpen || (isNarrow() && !main.classList.contains("outline-user-open"));
  main.classList.toggle("outline-collapsed", !wantOpen);
  if (isNarrow() && wantOpen) {
    narrowAutoCollapsed = !main.classList.contains("outline-user-open");
  } else {
    narrowAutoCollapsed = false;
    main.classList.remove("outline-user-open");
  }

  btnOutline.setAttribute("aria-pressed", String(wantOpen && !collapsed));
  zoomLabel.textContent = `${Math.round((prefs.zoom || 1) * 100)}%`;
}

async function savePrefs() {
  try {
    await invoke("set_prefs", { prefs });
  } catch (e) {
    console.error(e);
  }
}

function updateStatus() {
  zoomLabel.textContent = `${Math.round((prefs.zoom || 1) * 100)}%`;
  const hasDoc = Boolean(currentPath);
  statusbar.classList.toggle("has-doc", hasDoc);
  if (hasDoc) {
    statusHint.textContent = basename(currentPath);
    statusHint.title = currentPath;
    wordCountEl.textContent =
      currentWordCount === 1
        ? "1 word"
        : `${currentWordCount.toLocaleString()} words`;
  } else {
    statusHint.textContent = "";
    statusHint.title = "";
    wordCountEl.textContent = "";
  }
}

function isMermaidBlock(code) {
  return (
    code.classList.contains("language-mermaid") ||
    code.classList.contains("mermaid") ||
    [...code.classList].some((c) => c.toLowerCase() === "language-mermaid")
  );
}

function highlightCode() {
  if (!window.hljs) return;
  article.querySelectorAll("pre code").forEach((block) => {
    if (isMermaidBlock(block)) return;
    try {
      window.hljs.highlightElement(block);
    } catch (_) {
      /* ignore unknown languages */
    }
  });
}

let mermaidReady = false;

function mermaidThemeName() {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "default";
}

function ensureMermaid() {
  if (!window.mermaid || mermaidReady) return !!window.mermaid;
  try {
    window.mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: mermaidThemeName(),
      fontFamily: '"Open Sans", "Segoe UI", sans-serif',
    });
    mermaidReady = true;
    return true;
  } catch (e) {
    console.error("mermaid init failed", e);
    return false;
  }
}

/** Turn ```mermaid fences into diagram hosts (keeps source for re-theme). */
function prepareMermaidBlocks() {
  article.querySelectorAll("pre > code").forEach((code) => {
    if (!isMermaidBlock(code)) return;
    const pre = code.parentElement;
    if (!pre || pre.tagName !== "PRE") return;
    const source = code.textContent ?? "";
    const wrap = document.createElement("div");
    wrap.className = "mermaid-wrap";
    const srcEl = document.createElement("pre");
    srcEl.className = "mermaid-source";
    srcEl.hidden = true;
    srcEl.textContent = source;
    const host = document.createElement("div");
    host.className = "mermaid";
    host.textContent = source;
    wrap.append(srcEl, host);
    pre.replaceWith(wrap);
  });
}

function resetMermaidHosts() {
  article.querySelectorAll(".mermaid-wrap").forEach((wrap) => {
    const source = wrap.querySelector(".mermaid-source")?.textContent ?? "";
    const host = document.createElement("div");
    host.className = "mermaid";
    host.textContent = source;
    wrap.querySelectorAll(".mermaid, .mermaid-error").forEach((n) => n.remove());
    wrap.appendChild(host);
  });
}

async function renderMermaidDiagrams() {
  if (!ensureMermaid()) return;
  prepareMermaidBlocks();
  const nodes = [...article.querySelectorAll(".mermaid-wrap .mermaid")];
  if (!nodes.length) return;

  try {
    // Re-init theme each pass so light/dark stays in sync.
    window.mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: mermaidThemeName(),
      fontFamily: '"Open Sans", "Segoe UI", sans-serif',
    });
    await window.mermaid.run({ nodes });
  } catch (e) {
    console.error("mermaid run failed", e);
    nodes.forEach((node) => {
      if (node.querySelector("svg")) return;
      const err = document.createElement("div");
      err.className = "mermaid-error";
      err.textContent = "Mermaid diagram failed to render.";
      node.replaceWith(err);
    });
  }
}

function renderOutline(entries) {
  outline = entries || [];
  outlineList.innerHTML = "";
  for (const entry of outline) {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = entry.title;
    btn.dataset.level = String(entry.level);
    btn.dataset.id = entry.id;
    btn.addEventListener("click", () => {
      const el = document.getElementById(entry.id);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    li.appendChild(btn);
    outlineList.appendChild(li);
  }
  activeHeadingId = null;
  updateActiveHeading();
}

/** Content Y of an element relative to the preview scrollport. */
function offsetInPreview(el) {
  const rootTop = previewScroll.getBoundingClientRect().top;
  return el.getBoundingClientRect().top - rootTop + previewScroll.scrollTop;
}

/**
 * Scroll-spy: last heading whose top has crossed a probe line near the top of
 * the viewport. At document end, force the last outline entry so short trailing
 * sections still light up in the TOC.
 */
function updateActiveHeading() {
  const buttons = [...outlineList.querySelectorAll("button")];
  if (!outline.length || !buttons.length || article.hidden) {
    activeHeadingId = null;
    return;
  }

  const { scrollTop, clientHeight, scrollHeight } = previewScroll;
  const atBottom = scrollTop + clientHeight >= scrollHeight - 12;

  let activeId = outline[0].id;
  if (atBottom) {
    activeId = outline[outline.length - 1].id;
  } else {
    const probe = scrollTop + Math.min(96, Math.max(32, clientHeight * 0.2));
    for (const item of outline) {
      const el = document.getElementById(item.id);
      if (!el) continue;
      if (offsetInPreview(el) <= probe) activeId = item.id;
      else break;
    }
  }

  if (activeId === activeHeadingId) return;
  activeHeadingId = activeId;

  let activeBtn = null;
  for (const btn of buttons) {
    const on = btn.dataset.id === activeId;
    btn.classList.toggle("active", on);
    if (on) activeBtn = btn;
  }
  // Keep the active TOC row visible without stealing focus from the reader.
  activeBtn?.scrollIntoView({ block: "nearest", inline: "nearest" });
}

function onPreviewScroll() {
  if (tocScrollRaf) return;
  tocScrollRaf = requestAnimationFrame(() => {
    tocScrollRaf = 0;
    updateActiveHeading();
  });
}

function renderRecent() {
  const items = Array.isArray(prefs.recent) ? prefs.recent : [];
  recentList.innerHTML = "";
  if (!items.length) {
    recentWrap.hidden = true;
    return;
  }
  recentWrap.hidden = false;
  for (const path of items) {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    const name = document.createElement("span");
    name.className = "recent-name";
    name.textContent = basename(path);
    const dir = document.createElement("span");
    dir.className = "recent-dir";
    dir.textContent = dirname(path);
    btn.title = path;
    btn.append(name, dir);
    btn.addEventListener("click", async () => {
      try {
        await openPath(path);
      } catch (_) {
        prefs.recent = (prefs.recent || []).filter((p) => p !== path);
        await savePrefs();
        renderRecent();
      }
    });
    li.appendChild(btn);
    recentList.appendChild(li);
  }
}

function showDocument(doc) {
  showError(null);
  empty.classList.remove("visible");
  article.hidden = false;
  article.innerHTML = doc.html || "";
  currentPath = doc.path || "";
  currentWordCount = Number(doc.word_count) || 0;
  pathLabel.textContent = basename(currentPath) || doc.title || "";
  pathLabel.title = currentPath;
  document.title = `${doc.title || "markdown-look"} — markdown-look`;
  renderOutline(doc.outline || []);
  highlightCode();
  clearFind();
  updateStatus();
  void renderMermaidDiagrams().then(() => {
    requestAnimationFrame(updateActiveHeading);
  });

  if (currentPath) {
    prefs.recent = [currentPath, ...(prefs.recent || []).filter((p) => p !== currentPath)].slice(
      0,
      8
    );
  }
}

function showEmpty() {
  article.hidden = true;
  article.innerHTML = "";
  empty.classList.add("visible");
  outlineList.innerHTML = "";
  pathLabel.textContent = "";
  pathLabel.title = "";
  currentPath = "";
  currentWordCount = 0;
  updateStatus();
  renderRecent();
}

async function openPath(path, force = false) {
  try {
    const doc = await invoke("open_file", { path, force });
    showDocument(doc);
    try {
      prefs = (await invoke("get_prefs")) || prefs;
    } catch (_) {
      /* keep local */
    }
    renderRecent();
    return doc;
  } catch (e) {
    const msg = String(e);
    if (msg.includes("over 50 MB")) {
      if (confirm(`${msg}\n\nLoad anyway?`)) {
        return openPath(path, true);
      }
    }
    showError(msg);
    throw e;
  }
}

function captureScrollAnchor() {
  const rootRect = previewScroll.getBoundingClientRect();
  const headings = article.querySelectorAll("h1[id], h2[id], h3[id], h4[id], h5[id], h6[id]");
  let best = null;
  for (const el of headings) {
    const rect = el.getBoundingClientRect();
    if (rect.bottom < rootRect.top) continue;
    if (rect.top <= rootRect.top + 8) {
      best = { id: el.id, offset: rect.top - rootRect.top };
    } else if (!best) {
      best = { id: el.id, offset: rect.top - rootRect.top };
      break;
    } else {
      break;
    }
  }
  if (best) return best;
  return { id: null, offset: previewScroll.scrollTop };
}

function restoreScrollAnchor(anchor) {
  requestAnimationFrame(() => {
    if (anchor.id) {
      const el = document.getElementById(anchor.id);
      if (el) {
        const rootRect = previewScroll.getBoundingClientRect();
        const rect = el.getBoundingClientRect();
        previewScroll.scrollTop += rect.top - rootRect.top - (anchor.offset || 0);
      } else {
        previewScroll.scrollTop = anchor.offset || 0;
      }
    } else {
      previewScroll.scrollTop = anchor.offset || 0;
    }
    updateActiveHeading();
  });
}

async function reloadKeepingScroll() {
  const anchor = captureScrollAnchor();
  try {
    const doc = await invoke("reload");
    showDocument(doc);
    restoreScrollAnchor(anchor);
  } catch (e) {
    showError(String(e));
  }
}

/* —— Find (CSS Custom Highlight API) —— */

function clearFind() {
  findMatches = [];
  findIndex = -1;
  findCount.textContent = "";
  if (CSS.highlights) {
    CSS.highlights.delete("md-find");
    CSS.highlights.delete("md-find-current");
  }
}

function collectTextNodes(root) {
  const nodes = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = walker.nextNode())) {
    if (n.nodeValue && n.nodeValue.trim()) nodes.push(n);
  }
  return nodes;
}

function runFind(query) {
  clearFind();
  if (!query || article.hidden) {
    findCount.textContent = "0/0";
    return;
  }
  if (!CSS.highlights) {
    findCount.textContent = "N/A";
    return;
  }

  const lower = query.toLowerCase();
  const ranges = [];
  for (const node of collectTextNodes(article)) {
    const text = node.nodeValue;
    const hay = text.toLowerCase();
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

  findMatches = ranges;
  findIndex = ranges.length ? 0 : -1;
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
    const padding = 48;
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
  if (!findMatches.length) {
    findCount.textContent = "0/0";
    CSS.highlights.delete("md-find");
    CSS.highlights.delete("md-find-current");
    return;
  }
  const others = findMatches.filter((_, i) => i !== findIndex);
  CSS.highlights.set("md-find", new Highlight(...others));
  CSS.highlights.set("md-find-current", new Highlight(findMatches[findIndex]));
  findCount.textContent = `${findIndex + 1}/${findMatches.length}`;
  scrollRangeIntoView(findMatches[findIndex]);
}

function findNext(dir = 1) {
  if (!findMatches.length) return;
  findIndex = (findIndex + dir + findMatches.length) % findMatches.length;
  updateFindHighlight();
}

function openFind() {
  findBar.hidden = false;
  findBar.classList.add("visible");
  findInput.focus();
  findInput.select();
  if (findInput.value) runFind(findInput.value);
}

function closeFind() {
  findBar.classList.remove("visible");
  findBar.hidden = true;
  clearFind();
}

/* —— Link interception —— */

article.addEventListener("click", async (ev) => {
  const a = ev.target.closest("a");
  if (!a || !article.contains(a)) return;
  const href = a.getAttribute("href");
  if (!href) return;
  ev.preventDefault();

  if (href.startsWith("#")) {
    const id = decodeURIComponent(href.slice(1));
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: "smooth" });
    return;
  }

  if (href.startsWith("http://") || href.startsWith("https://") || href.startsWith("mailto:")) {
    try {
      await openUrl(href);
    } catch (e) {
      showError(String(e));
    }
    return;
  }

  const lower = href.toLowerCase();
  if (
    lower.endsWith(".md") ||
    lower.endsWith(".markdown") ||
    lower.endsWith(".mdx") ||
    lower.endsWith(".txt") ||
    lower.includes(".md#")
  ) {
    const pathPart = href.split("#")[0];
    try {
      const abs = await invoke("resolve_relative", { rel: pathPart });
      await openPath(abs);
      const hash = href.includes("#") ? href.split("#")[1] : null;
      if (hash) {
        requestAnimationFrame(() => {
          document.getElementById(decodeURIComponent(hash))?.scrollIntoView();
        });
      }
    } catch (e) {
      showError(String(e));
    }
  }
});

/* —— Title bar / shortcuts —— */

async function pickAndOpen() {
  try {
    const doc = await invoke("pick_file");
    if (doc) {
      showDocument(doc);
      try {
        prefs = (await invoke("get_prefs")) || prefs;
      } catch (_) {
        /* keep */
      }
      renderRecent();
    }
  } catch (e) {
    showError(String(e));
  }
}

document.getElementById("btn-open").addEventListener("click", pickAndOpen);
document.getElementById("btn-open-empty").addEventListener("click", pickAndOpen);

btnOutline.addEventListener("click", async () => {
  if (isNarrow() && prefs.outlineOpen) {
    const opening = !main.classList.contains("outline-user-open") && narrowAutoCollapsed;
    if (opening) {
      main.classList.add("outline-user-open");
      narrowAutoCollapsed = false;
      btnOutline.setAttribute("aria-pressed", "true");
      return;
    }
  }
  prefs.outlineOpen = !prefs.outlineOpen;
  main.classList.remove("outline-user-open");
  applyPrefs();
  await savePrefs();
});

document.getElementById("btn-find").addEventListener("click", openFind);
document.getElementById("find-close").addEventListener("click", closeFind);
document.getElementById("find-next").addEventListener("click", () => findNext(1));
document.getElementById("find-prev").addEventListener("click", () => findNext(-1));
findInput.addEventListener("input", () => scheduleFind(findInput.value));
findInput.addEventListener("keydown", (ev) => {
  if (ev.key === "Enter") {
    ev.preventDefault();
    findNext(ev.shiftKey ? -1 : 1);
  } else if (ev.key === "Escape") {
    closeFind();
  }
});

document.getElementById("btn-theme").addEventListener("click", async () => {
  prefs.theme = prefs.theme === "dark" ? "light" : "dark";
  applyPrefs();
  await savePrefs();
  if (!article.hidden) {
    resetMermaidHosts();
    void renderMermaidDiagrams();
  }
});

async function setZoom(next) {
  prefs.zoom = Math.min(2.5, Math.max(0.7, Math.round(next * 10) / 10));
  applyPrefs();
  updateStatus();
  await savePrefs();
}

zoomLabel.addEventListener("click", async () => {
  await setZoom(1);
});
btnZoomIn.addEventListener("click", () => setZoom((prefs.zoom || 1) + 0.1));
btnZoomOut.addEventListener("click", () => setZoom((prefs.zoom || 1) - 0.1));

window.addEventListener("keydown", (ev) => {
  const mod = ev.ctrlKey || ev.metaKey;
  if (mod && ev.key.toLowerCase() === "o") {
    ev.preventDefault();
    pickAndOpen();
  } else if (mod && ev.key.toLowerCase() === "f") {
    ev.preventDefault();
    openFind();
  } else if (ev.key === "Escape" && findBar.classList.contains("visible")) {
    closeFind();
  } else if (mod && (ev.key === "=" || ev.key === "+")) {
    ev.preventDefault();
    setZoom((prefs.zoom || 1) + 0.1);
  } else if (mod && ev.key === "-") {
    ev.preventDefault();
    setZoom((prefs.zoom || 1) - 0.1);
  } else if (mod && ev.key === "0") {
    ev.preventDefault();
    setZoom(1);
  }
});

/* —— Sidebar resizer —— */

function onResizePointerMove(ev) {
  if (!resizing) return;
  const bounds = main.getBoundingClientRect();
  const width = clampSidebarWidth(ev.clientX - bounds.left);
  prefs.sidebarWidth = width;
  applySidebarWidth();
}

async function endResize() {
  if (!resizing) return;
  resizing = false;
  resizer.classList.remove("dragging");
  window.removeEventListener("pointermove", onResizePointerMove);
  window.removeEventListener("pointerup", endResize);
  await savePrefs();
}

resizer.addEventListener("pointerdown", (ev) => {
  if (main.classList.contains("outline-collapsed")) return;
  resizing = true;
  resizer.classList.add("dragging");
  resizer.setPointerCapture?.(ev.pointerId);
  window.addEventListener("pointermove", onResizePointerMove);
  window.addEventListener("pointerup", endResize);
});

resizer.addEventListener("keydown", (ev) => {
  const step = ev.shiftKey ? 20 : 10;
  if (ev.key === "ArrowLeft") {
    ev.preventDefault();
    prefs.sidebarWidth = clampSidebarWidth(prefs.sidebarWidth - step);
    applySidebarWidth();
    savePrefs();
  } else if (ev.key === "ArrowRight") {
    ev.preventDefault();
    prefs.sidebarWidth = clampSidebarWidth(prefs.sidebarWidth + step);
    applySidebarWidth();
    savePrefs();
  }
});

previewScroll.addEventListener("scroll", onPreviewScroll, { passive: true });

window.addEventListener("resize", () => {
  applyPrefs();
  updateActiveHeading();
});

/* —— Boot —— */

async function boot() {
  try {
    prefs = (await invoke("get_prefs")) || prefs;
  } catch (_) {
    /* defaults */
  }
  prefs.sidebarWidth = clampSidebarWidth(prefs.sidebarWidth ?? 240);
  prefs.recent = Array.isArray(prefs.recent) ? prefs.recent : [];
  applyPrefs();
  updateStatus();
  renderRecent();

  await listen("doc-changed", () => {
    reloadKeepingScroll();
  });

  await listen("file-drop", async () => {
    try {
      const pending = await invoke("take_pending_path");
      if (pending) await openPath(pending);
    } catch (e) {
      showError(String(e));
    }
  });

  try {
    const pending = await invoke("take_pending_path");
    if (pending) {
      await openPath(pending);
      return;
    }
  } catch (e) {
    showError(String(e));
  }

  showEmpty();
}

boot();
