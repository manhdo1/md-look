/* markdown-look frontend — no Markdown parser; Rust supplies HTML + outline. */

const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;
const { openUrl } = window.__TAURI__.opener;

const $ = (id) => document.getElementById(id);

let article = $("article");
const empty = $("empty");
const outlineList = $("outline-list");
const outlineEmpty = $("outline-empty");
const pathLabel = $("path-label");
const pathDir = $("path-dir");
const docTitle = $("doc-title");
const errorBanner = $("error-banner");
const errorText = $("error-text");
const previewScroll = $("preview-scroll");
const main = $("main");
const findBar = $("find-bar");
const findInput = $("find-input");
const findCount = $("find-count");
const zoomLabel = $("zoom-label");
const wordCountEl = $("word-count");
const progressEl = $("read-progress");
const sectionEl = $("status-section");
const statusbar = $("statusbar");
const recentWrap = $("recent");
const recentList = $("recent-list");
const resizer = $("resizer");
const btnOutline = $("btn-outline");
const dialog = $("diagram-dialog");
const tabbar = $("tabbar");

const NARROW_BREAKPOINT = 760;
const SIDEBAR_MIN = 180;
const SIDEBAR_MAX = 420;
const FIND_DEBOUNCE_MS = 120;
const XLINK = "http://www.w3.org/1999/xlink";
/** Below this, 15px diagram labels drop under ~10px and stop being readable. */
const INLINE_MIN_SCALE = 0.68;
const MAX_LIVE_TABS = 6;
const MAX_CLOSED_STACK = 10;

let prefs = {
  theme: "light",
  zoom: 1,
  outlineOpen: true,
  sidebarWidth: 248,
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
let scrollRaf = 0;

/** @type {Map<string, object>} */
const tabs = new Map();
/** @type {string[]} */
let order = [];
/** @type {string | null} */
let activeId = null;
let nextTabId = 1;
/** @type {string[]} */
const closedStack = [];
/** @type {string[]} */
let lruOrder = [];

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

function parentBasename(path) {
  const dir = dirname(path);
  if (!dir) return "";
  return basename(dir);
}

/** Case-insensitive path compare for Windows. */
function samePath(a, b) {
  if (!a || !b) return false;
  const na = a.replace(/\\/g, "/");
  const nb = b.replace(/\\/g, "/");
  return na.toLowerCase() === nb.toLowerCase();
}

function findTabByPath(path) {
  for (const tab of tabs.values()) {
    if (samePath(tab.path, path)) return tab;
  }
  return null;
}

function activeTab() {
  return activeId ? tabs.get(activeId) || null : null;
}

function touchLru(id) {
  lruOrder = lruOrder.filter((x) => x !== id);
  lruOrder.push(id);
}

function createArticleEl() {
  const el = document.createElement("article");
  el.id = "article";
  el.hidden = true;
  return el;
}

function icon(name) {
  return `<svg class="icon" aria-hidden="true"><use href="#i-${name}" /></svg>`;
}

function showError(msg) {
  errorText.textContent = msg || "";
  errorBanner.classList.toggle("visible", Boolean(msg));
}

function clampSidebarWidth(w) {
  const n = Number(w);
  if (!Number.isFinite(n)) return 248;
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
  main.classList.toggle("no-doc", !hasDoc);
  if (hasDoc) {
    wordCountEl.textContent =
      currentWordCount === 1 ? "1 word" : `${currentWordCount.toLocaleString()} words`;
  } else {
    wordCountEl.textContent = "";
    sectionEl.textContent = "";
    progressEl.textContent = "";
  }
  updateProgress();
}

function updateProgress() {
  if (article.hidden) {
    statusbar.style.setProperty("--progress", "0");
    return;
  }
  const { scrollTop, clientHeight, scrollHeight } = previewScroll;
  const max = scrollHeight - clientHeight;
  const p = max <= 0 ? 1 : Math.min(1, Math.max(0, scrollTop / max));
  statusbar.style.setProperty("--progress", p.toFixed(4));
  progressEl.textContent = `${Math.round(p * 100)}%`;
}

/* —— Clipboard —— */

async function copyText(text, btn) {
  try {
    await navigator.clipboard.writeText(text);
    const label = btn.querySelector("span");
    const prev = label?.textContent;
    btn.classList.add("done");
    btn.querySelector("use")?.setAttribute("href", "#i-check");
    if (label) label.textContent = "Copied";
    setTimeout(() => {
      btn.classList.remove("done");
      btn.querySelector("use")?.setAttribute("href", "#i-copy");
      if (label) label.textContent = prev;
    }, 1400);
  } catch (e) {
    showError(`Could not copy to the clipboard: ${e}`);
  }
}

function copyButton(getText, label = "Copy") {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "text-btn";
  btn.title = "Copy to clipboard";
  btn.innerHTML = `${icon("copy")}<span>${label}</span>`;
  btn.addEventListener("click", () => copyText(getText(), btn));
  return btn;
}

/* —— Code blocks —— */

function isMermaidBlock(code) {
  return [...code.classList].some((c) => {
    const l = c.toLowerCase();
    return l === "language-mermaid" || l === "mermaid";
  });
}

function codeLanguage(code) {
  const cls = [...code.classList].find((c) => c.startsWith("language-"));
  return cls ? cls.slice("language-".length) : "";
}

function enhanceCodeBlocks() {
  article.querySelectorAll("pre > code").forEach((code) => {
    if (isMermaidBlock(code)) return;
    const pre = code.parentElement;
    if (window.hljs) {
      try {
        window.hljs.highlightElement(code);
      } catch (_) {
        /* unknown language */
      }
    }
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

/* —— Pan / zoom —— */

class PanZoom {
  constructor(viewport, canvas, { wheelZoom = false, maxFit = 1, minFit = 0.05, onChange } = {}) {
    this.viewport = viewport;
    this.canvas = canvas;
    this.wheelZoom = wheelZoom;
    this.maxFit = maxFit;
    this.minFit = minFit;
    this.onChange = onChange;
    this.s = 1;
    this.x = 0;
    this.y = 0;
    this.w = 0;
    this.h = 0;
    this.userMoved = false;
    this.drag = null;
    this.suppressClick = false;

    viewport.addEventListener("pointerdown", (e) => this.onDown(e));
    viewport.addEventListener("pointermove", (e) => this.onMove(e));
    viewport.addEventListener("pointerup", (e) => this.onUp(e));
    viewport.addEventListener("pointercancel", (e) => this.onUp(e));
    viewport.addEventListener("wheel", (e) => this.onWheel(e), { passive: false });
    viewport.addEventListener("dblclick", (e) => {
      if (e.target.closest("a")) return;
      this.fit(true);
    });
    viewport.addEventListener(
      "click",
      (e) => {
        if (this.suppressClick) {
          e.preventDefault();
          e.stopPropagation();
          this.suppressClick = false;
        }
      },
      true
    );
  }

  setContent(w, h) {
    this.w = w;
    this.h = h;
    this.userMoved = false;
  }

  get pad() {
    return 24;
  }

  fitScale() {
    const vw = this.viewport.clientWidth;
    const vh = this.viewport.clientHeight;
    if (!this.w || !this.h || !vw || !vh) return 1;
    return Math.min(this.maxFit, (vw - this.pad * 2) / this.w, (vh - this.pad * 2) / this.h);
  }

  apply(animate = false) {
    this.canvas.classList.toggle("animate", animate);
    this.canvas.style.transform = `translate(${this.x}px, ${this.y}px) scale(${this.s})`;
    this.onChange?.(this.s);
  }

  center(scale) {
    const vw = this.viewport.clientWidth;
    const vh = this.viewport.clientHeight;
    this.s = scale;
    const cw = this.w * scale;
    const ch = this.h * scale;
    this.x = cw + this.pad * 2 <= vw ? (vw - cw) / 2 : this.pad;
    this.y = ch + this.pad * 2 <= vh ? (vh - ch) / 2 : this.pad;
  }

  /** True when the fitted scale was clamped up, so part of the diagram is off-screen. */
  get clipped() {
    return this.fitScale() < this.minFit;
  }

  fit(animate = false) {
    this.center(Math.max(this.minFit, this.fitScale()));
    this.userMoved = false;
    this.apply(animate);
  }

  actualSize() {
    this.center(1);
    this.userMoved = true;
    this.apply(true);
  }

  zoomAt(factor, px, py, animate = false) {
    const next = Math.min(8, Math.max(0.1, this.s * factor));
    const k = next / this.s;
    this.x = px - (px - this.x) * k;
    this.y = py - (py - this.y) * k;
    this.s = next;
    this.userMoved = true;
    this.apply(animate);
  }

  zoomBy(factor) {
    this.zoomAt(factor, this.viewport.clientWidth / 2, this.viewport.clientHeight / 2, true);
  }

  onDown(e) {
    if (e.button !== 0) return;
    this.drag = { id: e.pointerId, sx: e.clientX, sy: e.clientY, x: this.x, y: this.y, moved: false };
  }

  onMove(e) {
    const d = this.drag;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.sx;
    const dy = e.clientY - d.sy;
    if (!d.moved && Math.hypot(dx, dy) < 4) return;
    if (!d.moved) {
      d.moved = true;
      this.viewport.setPointerCapture(e.pointerId);
      this.viewport.classList.add("panning");
    }
    this.x = d.x + dx;
    this.y = d.y + dy;
    this.userMoved = true;
    this.apply(false);
  }

  onUp(e) {
    const d = this.drag;
    if (!d || d.id !== e.pointerId) return;
    if (d.moved) {
      this.suppressClick = true;
      setTimeout(() => (this.suppressClick = false), 0);
    }
    this.viewport.classList.remove("panning");
    this.drag = null;
  }

  onWheel(e) {
    if (!this.wheelZoom && !e.ctrlKey) return;
    e.preventDefault();
    const rect = this.viewport.getBoundingClientRect();
    const factor = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0018));
    this.zoomAt(factor, e.clientX - rect.left, e.clientY - rect.top);
  }
}

/* —— Mermaid —— */

const diagramHeights = new Map();
const SVG_CACHE_MAX = 80;
const svgCache = new Map();
/** @type {Set<HTMLElement>} */
const diagramQueue = new Set();
let diagramWorker = null;
let mermaidSeq = 0;
let mermaidTheme = null;

/** Draw diagrams only when they come within one screen of the reader's viewport. */
const diagramObserver = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      entry.target._near = entry.isIntersecting;
      if (entry.isIntersecting) scheduleDiagram(entry.target);
    }
  },
  { root: previewScroll, rootMargin: "100% 0px" }
);

function mermaidConfig() {
  const dark = document.documentElement.dataset.theme === "dark";
  const t = dark
    ? {
        background: "#1b2029",
        primaryColor: "#252b36",
        primaryBorderColor: "#9aa4b6",
        primaryTextColor: "#e7eaf0",
        secondaryColor: "#2b2330",
        secondaryBorderColor: "#a07a86",
        tertiaryColor: "#1f2530",
        tertiaryBorderColor: "#4a5262",
        lineColor: "#8d97aa",
        textColor: "#d9dde5",
        clusterBkg: "#20262f",
        clusterBorder: "#3e4656",
        edgeLabelBackground: "#1d2129",
        noteBkgColor: "#3a2622",
        noteTextColor: "#f1e4df",
        noteBorderColor: "#d9734f",
        actorBkg: "#252b36",
        actorBorder: "#9aa4b6",
        actorTextColor: "#e7eaf0",
        actorLineColor: "#4f5768",
        signalColor: "#c5ccd8",
        signalTextColor: "#e7eaf0",
        labelBoxBkgColor: "#252b36",
        labelBoxBorderColor: "#9aa4b6",
        labelTextColor: "#e7eaf0",
        loopTextColor: "#e7eaf0",
        activationBkgColor: "#323a48",
        activationBorderColor: "#9aa4b6",
        sequenceNumberColor: "#1b2029",
      }
    : {
        background: "#ffffff",
        primaryColor: "#ffffff",
        primaryBorderColor: "#2b3343",
        primaryTextColor: "#1b2130",
        secondaryColor: "#fdf0ec",
        secondaryBorderColor: "#c9563d",
        tertiaryColor: "#f4f6f9",
        tertiaryBorderColor: "#cdd3dd",
        lineColor: "#6b7486",
        textColor: "#2b3343",
        clusterBkg: "#f4f6f9",
        clusterBorder: "#cdd3dd",
        edgeLabelBackground: "#f9fafb",
        noteBkgColor: "#fdf0ec",
        noteTextColor: "#1b2130",
        noteBorderColor: "#d2462f",
        actorBkg: "#ffffff",
        actorBorder: "#2b3343",
        actorTextColor: "#1b2130",
        actorLineColor: "#b4bbc8",
        signalColor: "#2b3343",
        signalTextColor: "#1b2130",
        labelBoxBkgColor: "#ffffff",
        labelBoxBorderColor: "#2b3343",
        labelTextColor: "#1b2130",
        loopTextColor: "#1b2130",
        activationBkgColor: "#f1f3f7",
        activationBorderColor: "#2b3343",
        sequenceNumberColor: "#ffffff",
      };
  const font = '"Be Vietnam Pro", "Segoe UI", sans-serif';
  return {
    startOnLoad: false,
    securityLevel: "antiscript",
    theme: "base",
    darkMode: dark,
    fontFamily: font,
    themeVariables: { ...t, fontFamily: font, fontSize: "15px" },
    flowchart: { useMaxWidth: false, htmlLabels: true, padding: 14, nodeSpacing: 46, rankSpacing: 54 },
    sequence: { useMaxWidth: false, actorFontFamily: font, noteFontFamily: font, messageFontFamily: font },
    class: { useMaxWidth: false },
    state: { useMaxWidth: false },
    er: { useMaxWidth: false },
    gantt: { useMaxWidth: false },
    journey: { useMaxWidth: false },
    pie: { useMaxWidth: false },
    mindmap: { useMaxWidth: false },
    timeline: { useMaxWidth: false },
    gitGraph: { useMaxWidth: false },
  };
}

function initMermaid() {
  if (!window.mermaid) return false;
  try {
    window.mermaid.initialize(mermaidConfig());
    return true;
  } catch (e) {
    console.error("mermaid init failed", e);
    return false;
  }
}

function diagramKind(source) {
  const lines = source.split(/\r?\n/);
  let inFront = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line === "---") {
      inFront = !inFront;
      continue;
    }
    if (inFront || line.startsWith("%%")) continue;
    const token = line.split(/[\s{]/)[0];
    const map = {
      graph: "flowchart",
      flowchart: "flowchart",
      sequenceDiagram: "sequence",
      classDiagram: "class",
      stateDiagram: "state",
      "stateDiagram-v2": "state",
      erDiagram: "entity relationship",
      gantt: "gantt",
      pie: "pie chart",
      journey: "user journey",
      gitGraph: "git graph",
      mindmap: "mindmap",
      timeline: "timeline",
      quadrantChart: "quadrant chart",
      requirementDiagram: "requirement",
      C4Context: "C4",
      sankey: "sankey",
      "sankey-beta": "sankey",
      xychart: "xy chart",
      "xychart-beta": "xy chart",
      block: "block",
      "block-beta": "block",
      architecture: "architecture",
      "architecture-beta": "architecture",
    };
    return map[token] || token;
  }
  return "";
}

/** Size the SVG to its viewBox so pan/zoom works in real pixels. */
function normalizeSvg(svg) {
  const vb = svg.viewBox?.baseVal;
  let w = vb && vb.width ? vb.width : parseFloat(svg.getAttribute("width")) || 0;
  let h = vb && vb.height ? vb.height : parseFloat(svg.getAttribute("height")) || 0;
  if (!w || !h) {
    const r = svg.getBoundingClientRect();
    w = r.width;
    h = r.height;
  }
  svg.style.maxWidth = "none";
  svg.setAttribute("width", String(w));
  svg.setAttribute("height", String(h));
  return { w, h };
}

function currentTheme() {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

/** Re-initialize Mermaid only when the theme it was configured for changes. */
function ensureMermaid() {
  const theme = currentTheme();
  if (mermaidTheme === theme) return true;
  if (!initMermaid()) return false;
  mermaidTheme = theme;
  return true;
}

/** Rendered SVG (or parse error) per theme + source, most recently used last. */
async function mermaidSvg(source) {
  const key = `${mermaidTheme}\n${source}`;
  const cached = svgCache.get(key);
  if (cached) {
    svgCache.delete(key);
    svgCache.set(key, cached);
    return cached;
  }
  const id = `mmd-${++mermaidSeq}`;
  let entry;
  try {
    const { svg, bindFunctions } = await window.mermaid.render(id, source);
    entry = { svg, bindFunctions, w: 0, h: 0 };
  } catch (error) {
    entry = { error };
  } finally {
    for (const strayId of [`d${id}`, id]) {
      document.getElementById(strayId)?.remove();
    }
  }
  svgCache.set(key, entry);
  if (svgCache.size > SVG_CACHE_MAX) svgCache.delete(svgCache.keys().next().value);
  return entry;
}

async function renderMermaidInto(canvas, source) {
  if (!ensureMermaid()) return null;
  const entry = await mermaidSvg(source);
  if (entry.error) throw entry.error;
  canvas.innerHTML = entry.svg;
  entry.bindFunctions?.(canvas);
  const el = canvas.querySelector("svg");
  if (!el) return null;
  if (!entry.w || !entry.h) {
    const size = normalizeSvg(el);
    entry.w = size.w;
    entry.h = size.h;
    return size;
  }
  el.style.maxWidth = "none";
  el.setAttribute("width", String(entry.w));
  el.setAttribute("height", String(entry.h));
  return { w: entry.w, h: entry.h };
}

function toolButton(act, iconName, title, extraClass = "") {
  const b = document.createElement("button");
  b.type = "button";
  b.className = `icon-btn ${extraClass}`.trim();
  b.dataset.act = act;
  b.title = title;
  b.setAttribute("aria-label", title.replace(/\s*\(.*\)$/, ""));
  b.innerHTML = icon(iconName);
  return b;
}

function buildDiagram(source) {
  const dg = document.createElement("figure");
  dg.className = "diagram";
  dg.dataset.view = "map";
  dg.dataset.source = source;

  const head = document.createElement("div");
  head.className = "block-head";

  const left = document.createElement("div");
  left.className = "dg-head-left";
  const tabs = document.createElement("div");
  tabs.className = "dg-tabs";
  tabs.setAttribute("role", "tablist");
  tabs.setAttribute("aria-label", "Diagram view");
  for (const [view, label] of [
    ["map", "Diagram"],
    ["source", "Source"],
  ]) {
    const t = document.createElement("button");
    t.type = "button";
    t.className = "dg-tab";
    t.setAttribute("role", "tab");
    t.dataset.view = view;
    t.textContent = label;
    t.setAttribute("aria-selected", String(view === "map"));
    t.addEventListener("click", () => setDiagramView(dg, view));
    tabs.appendChild(t);
  }
  const kind = document.createElement("span");
  kind.className = "dg-kind";
  kind.textContent = diagramKind(source);
  left.append(tabs, kind);

  const tools = document.createElement("div");
  tools.className = "dg-tools";
  const zoomBtn = document.createElement("button");
  zoomBtn.type = "button";
  zoomBtn.className = "dg-zoom dg-map-only";
  zoomBtn.dataset.act = "reset";
  zoomBtn.title = "Actual size";
  zoomBtn.setAttribute("aria-label", "Zoom level, click for actual size");
  zoomBtn.textContent = "100%";
  const sep = document.createElement("span");
  sep.className = "dg-sep dg-map-only";
  sep.setAttribute("aria-hidden", "true");
  const copy = copyButton(() => source, "Copy source");
  copy.classList.add("dg-source-only");
  tools.append(
    toolButton("zoom-out", "minus", "Zoom out (Ctrl+scroll)", "dg-map-only"),
    zoomBtn,
    toolButton("zoom-in", "plus", "Zoom in (Ctrl+scroll)", "dg-map-only"),
    toolButton("fit", "fit", "Fit (double-click)", "dg-map-only"),
    sep,
    toolButton("expand", "expand", "Open full window", "dg-map-only"),
    copy
  );
  head.append(left, tools);

  const viewport = document.createElement("div");
  viewport.className = "dg-viewport";
  viewport.style.height = `${diagramHeights.get(source) || 220}px`;
  const canvas = document.createElement("div");
  canvas.className = "dg-canvas";
  viewport.appendChild(canvas);

  const src = document.createElement("pre");
  src.className = "dg-source";
  const code = document.createElement("code");
  code.className = "language-mermaid";
  code.textContent = source;
  src.appendChild(code);

  dg.append(head, viewport, src);

  const hint = document.createElement("button");
  hint.type = "button";
  hint.className = "dg-more";
  hint.innerHTML = `${icon("expand")}<span>Drag to pan, or open full window</span>`;
  hint.addEventListener("click", () => openDiagramDialog(dg));
  hint.addEventListener("pointerdown", (e) => e.stopPropagation());
  viewport.appendChild(hint);

  const pz = new PanZoom(viewport, canvas, {
    minFit: INLINE_MIN_SCALE,
    onChange: (s) => (zoomBtn.textContent = `${Math.round(s * 100)}%`),
  });
  dg._pz = pz;
  dg._viewport = viewport;
  dg._canvas = canvas;

  tools.addEventListener("click", (e) => {
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (act === "zoom-in") pz.zoomBy(1.25);
    else if (act === "zoom-out") pz.zoomBy(0.8);
    else if (act === "fit") pz.fit(true);
    else if (act === "reset") pz.actualSize();
    else if (act === "expand") openDiagramDialog(dg);
  });

  let lastWidth = 0;
  new ResizeObserver(() => {
    const width = viewport.clientWidth;
    if (!width || width === lastWidth || !pz.w) return;
    lastWidth = width;
    sizeViewport(dg);
    if (!pz.userMoved) pz.fit();
  }).observe(viewport);

  return dg;
}

function sizeViewport(dg) {
  const pz = dg._pz;
  const vw = dg._viewport.clientWidth;
  if (!pz.w || !vw) return;
  const scale = Math.max(INLINE_MIN_SCALE, Math.min(1, (vw - pz.pad * 2) / pz.w));
  const maxH = Math.max(260, Math.min(620, window.innerHeight * 0.68));
  const h = Math.round(Math.min(maxH, Math.max(140, pz.h * scale + pz.pad * 2)));
  dg._viewport.style.height = `${h}px`;
  diagramHeights.set(dg.dataset.source, h);
  dg.classList.toggle("clipped", pz.clipped);
}

function setDiagramView(dg, view) {
  dg.dataset.view = view;
  dg.querySelectorAll(".dg-tab").forEach((t) =>
    t.setAttribute("aria-selected", String(t.dataset.view === view))
  );
  if (view === "map" && dg._pz.w && !dg._pz.userMoved) {
    requestAnimationFrame(() => {
      sizeViewport(dg);
      dg._pz.fit();
    });
  }
  if (findBar.classList.contains("visible") && findInput.value) runFind(findInput.value);
}

function showDiagramError(dg, err) {
  dg.classList.add("failed");
  dg.dataset.view = "source";
  const box = document.createElement("div");
  box.className = "dg-error";
  const msg = String(err?.message || err || "Unknown error")
    .split("\n")
    .slice(0, 6)
    .join("\n");
  box.innerHTML = `${icon("alert")}<div><strong>This Mermaid diagram has a syntax error.</strong><code></code></div>`;
  box.querySelector("code").textContent = msg;
  dg.querySelector(".block-head").after(box);
}

function prepareDiagrams() {
  const out = [];
  article.querySelectorAll("pre > code").forEach((code) => {
    if (!isMermaidBlock(code)) return;
    const pre = code.parentElement;
    const dg = buildDiagram(code.textContent ?? "");
    pre.replaceWith(dg);
    diagramObserver.observe(dg);
    out.push(dg);
  });
  return out;
}

/** Stop observing diagrams of an article that is being replaced, evicted, or closed. */
function releaseDiagrams(root) {
  root?.querySelectorAll(".diagram").forEach((dg) => {
    diagramObserver.unobserve(dg);
    diagramQueue.delete(dg);
  });
}

async function renderDiagram(dg) {
  const theme = currentTheme();
  dg.classList.remove("failed");
  dg.querySelector(".dg-error")?.remove();
  try {
    const size = await renderMermaidInto(dg._canvas, dg.dataset.source);
    // Detached mid-render: the viewport has no size to fit against. Redraw (from cache)
    // when the tab is shown again.
    if (!dg.isConnected) return;
    dg.dataset.rendered = theme;
    if (!size) return;
    dg._pz.setContent(size.w, size.h);
    sizeViewport(dg);
    dg._pz.fit();
  } catch (e) {
    dg.dataset.rendered = theme;
    dg._canvas.innerHTML = "";
    showDiagramError(dg, e);
  }
}

async function drainDiagramQueue() {
  try {
    await document.fonts.load('15px "Be Vietnam Pro"');
  } catch (_) {
    /* fall back to whatever is loaded */
  }
  while (diagramQueue.size) {
    const dg = diagramQueue.values().next().value;
    diagramQueue.delete(dg);
    if (!dg.isConnected || !dg._near || dg.dataset.rendered === currentTheme()) continue;
    await renderDiagram(dg);
  }
}

function kickDiagramQueue() {
  if (diagramWorker) return;
  diagramWorker = drainDiagramQueue().finally(() => {
    diagramWorker = null;
    if (diagramQueue.size) kickDiagramQueue();
  });
}

function scheduleDiagram(dg) {
  if (dg.dataset.rendered === currentTheme()) return;
  diagramQueue.add(dg);
  kickDiagramQueue();
}

/** Resolves once every queued diagram near the viewport has been drawn. */
function diagramsIdle() {
  return diagramWorker ? diagramWorker.then(diagramsIdle) : Promise.resolve();
}

/** Re-queue on-screen diagrams of the active article (theme change). */
function rescheduleVisibleDiagrams() {
  article.querySelectorAll(".diagram").forEach((dg) => {
    if (dg._near) scheduleDiagram(dg);
  });
}

/* —— Fullscreen diagram —— */

const dlgViewport = dialog.querySelector(".dg-viewport");
const dlgCanvas = dialog.querySelector(".dg-canvas");
const dlgZoom = dialog.querySelector(".dg-zoom");
const dlgTitle = dialog.querySelector(".dlg-title");
const dialogPz = new PanZoom(dlgViewport, dlgCanvas, {
  wheelZoom: true,
  maxFit: 2,
  onChange: (s) => (dlgZoom.textContent = `${Math.round(s * 100)}%`),
});

async function openDiagramDialog(dg) {
  const source = dg.dataset.source;
  const kind = diagramKind(source);
  dlgTitle.textContent = kind ? `${kind[0].toUpperCase()}${kind.slice(1)} diagram` : "Diagram";
  dlgCanvas.innerHTML = "";
  dialog.showModal();
  try {
    const size = await renderMermaidInto(dlgCanvas, source);
    if (!size) return;
    dialogPz.setContent(size.w, size.h);
    requestAnimationFrame(() => dialogPz.fit());
  } catch (e) {
    dialog.close();
    showError(`Diagram failed to render: ${e?.message || e}`);
  }
}

dialog.addEventListener("close", () => {
  dlgCanvas.innerHTML = "";
});

dialog.querySelector(".dg-tools").addEventListener("click", (e) => {
  const act = e.target.closest("[data-act]")?.dataset.act;
  if (act === "zoom-in") dialogPz.zoomBy(1.25);
  else if (act === "zoom-out") dialogPz.zoomBy(0.8);
  else if (act === "fit") dialogPz.fit(true);
  else if (act === "reset") dialogPz.actualSize();
  else if (act === "close") dialog.close();
});

dialog.addEventListener("keydown", (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === "+" || e.key === "=") dialogPz.zoomBy(1.25);
  else if (e.key === "-") dialogPz.zoomBy(0.8);
  else if (e.key === "0") dialogPz.actualSize();
  else if (e.key.toLowerCase() === "f") dialogPz.fit(true);
  else return;
  e.preventDefault();
});

new ResizeObserver(() => {
  if (dialog.open && !dialogPz.userMoved) dialogPz.fit();
}).observe(dlgViewport);

/* —— Outline —— */

function renderOutline(entries) {
  outline = entries || [];
  outlineList.innerHTML = "";
  outlineEmpty.hidden = outline.length > 0 || article.hidden;
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

function offsetInPreview(el) {
  const rootTop = previewScroll.getBoundingClientRect().top;
  return el.getBoundingClientRect().top - rootTop + previewScroll.scrollTop;
}

/**
 * Scroll-spy: last heading whose top has crossed a probe line near the top of
 * the viewport. At document end, force the last entry so short trailing
 * sections still light up.
 */
function updateActiveHeading() {
  const items = [...outlineList.children];
  if (!outline.length || !items.length || article.hidden) {
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
    outline.forEach((item, i) => {
      const el = document.getElementById(item.id);
      if (el && offsetInPreview(el) <= probe) activeIdx = i;
    });
  }

  const activeId = outline[activeIdx].id;
  if (activeId === activeHeadingId) return;
  activeHeadingId = activeId;
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

function onPreviewScroll() {
  if (scrollRaf) return;
  scrollRaf = requestAnimationFrame(() => {
    scrollRaf = 0;
    updateActiveHeading();
    updateProgress();
  });
}

/* —— Recent files —— */

function renderRecent() {
  const items = Array.isArray(prefs.recent) ? prefs.recent : [];
  recentList.innerHTML = "";
  recentWrap.hidden = !items.length;
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

/* —— Tabs —— */

function attachArticle(tab) {
  empty.classList.remove("visible");
  empty.hidden = true;
  if (article && article !== tab.el && article.parentNode === previewScroll) {
    article.remove();
  }
  article = tab.el;
  article.hidden = false;
  if (!article.isConnected) {
    previewScroll.appendChild(article);
  }
}

function updateChromeForTab(tab) {
  currentPath = tab?.path || "";
  currentWordCount = tab ? Number(tab.wordCount) || 0 : 0;
  outline = tab?.outline || [];
  pathLabel.textContent = tab ? basename(tab.path) || tab.title || "" : "";
  pathDir.textContent = tab ? dirname(tab.path) : "";
  docTitle.title = tab?.path || "";
  document.title = tab
    ? `${tab.title || basename(tab.path) || "markdown-look"} — markdown-look`
    : "markdown-look";
  updateStatus();
  void invoke("set_active", { title: tab ? tab.title || basename(tab.path) : null }).catch(() => {});
}

function basenameCounts() {
  const counts = new Map();
  for (const id of order) {
    const tab = tabs.get(id);
    if (!tab) continue;
    const name = basename(tab.path).toLowerCase();
    counts.set(name, (counts.get(name) || 0) + 1);
  }
  return counts;
}

function renderTabbar() {
  const show = tabs.size >= 2;
  tabbar.hidden = !show;
  if (!show) {
    tabbar.innerHTML = "";
    return;
  }

  const counts = basenameCounts();
  const prevFocus = document.activeElement?.closest?.(".tab")?.dataset?.tabId;
  tabbar.innerHTML = "";

  for (const id of order) {
    const tab = tabs.get(id);
    if (!tab) continue;
    const name = basename(tab.path);
    const dup = (counts.get(name.toLowerCase()) || 0) > 1;
    const el = document.createElement("div");
    el.className = "tab";
    el.setAttribute("role", "tab");
    el.dataset.tabId = id;
    el.setAttribute("aria-selected", String(id === activeId));
    el.setAttribute("aria-controls", "preview-scroll");
    el.tabIndex = id === activeId ? 0 : -1;
    el.title = tab.path;

    const label = document.createElement("span");
    label.className = "tab-label";
    label.textContent = name || tab.title || "untitled";
    el.appendChild(label);

    if (dup) {
      const dir = document.createElement("span");
      dir.className = "tab-dir";
      dir.textContent = parentBasename(tab.path);
      el.appendChild(dir);
    }

    const close = document.createElement("button");
    close.type = "button";
    close.className = "tab-close";
    close.title = "Close tab";
    close.setAttribute("aria-label", `Close ${name || "tab"}`);
    close.innerHTML = icon("close");
    el.appendChild(close);
    tabbar.appendChild(el);
  }

  const activeEl = tabbar.querySelector(`.tab[data-tab-id="${activeId}"]`);
  activeEl?.scrollIntoView({ inline: "nearest", block: "nearest" });
  if (prevFocus) {
    tabbar.querySelector(`.tab[data-tab-id="${prevFocus}"]`)?.focus();
  }
}

function refreshTabSelection() {
  if (tabbar.hidden) return;
  tabbar.querySelectorAll(".tab").forEach((el) => {
    const selected = el.dataset.tabId === activeId;
    el.setAttribute("aria-selected", String(selected));
    el.tabIndex = selected ? 0 : -1;
  });
  tabbar
    .querySelector(`.tab[data-tab-id="${activeId}"]`)
    ?.scrollIntoView({ inline: "nearest", block: "nearest" });
}

function evictLiveTabsIfNeeded() {
  const live = order.filter((id) => tabs.get(id)?.el);
  if (live.length <= MAX_LIVE_TABS) return;
  const victims = lruOrder.filter((id) => id !== activeId && tabs.get(id)?.el);
  while (order.filter((id) => tabs.get(id)?.el).length > MAX_LIVE_TABS && victims.length) {
    const id = victims.shift();
    const tab = tabs.get(id);
    if (!tab?.el) continue;
    releaseDiagrams(tab.el);
    tab.el = null;
    tab.stale = true;
  }
}

function fillArticleFromDoc(tab, doc) {
  if (!tab.el) tab.el = createArticleEl();
  releaseDiagrams(tab.el);
  article = tab.el;
  article.hidden = false;
  article.innerHTML = doc.html || "";
  tab.path = doc.path || tab.path;
  tab.title = doc.title || basename(tab.path);
  tab.outline = doc.outline || [];
  tab.wordCount = Number(doc.word_count) || 0;
  tab.stale = false;
  prepareDiagrams();
  enhanceCodeBlocks();
}

async function activateTab(id, { restoreScroll = true } = {}) {
  if (!tabs.has(id)) return;
  const next = tabs.get(id);
  const prev = activeTab();
  if (prev === next && next.el?.isConnected && !next.stale) return;

  if (prev && prev.id !== id) {
    clearFind();
    if (prev.el?.isConnected) {
      prev.scrollTop = previewScroll.scrollTop;
      prev.el.remove();
    }
  }

  activeId = id;
  touchLru(id);

  if (!next.el || next.stale) {
    let doc;
    try {
      doc = await invoke("reload", { path: next.path });
    } catch (e) {
      showError(String(e));
      if (activeId === id && prev && prev !== next && tabs.has(prev.id)) {
        activeId = null;
        await activateTab(prev.id);
      }
      return;
    }
    const shown = article;
    fillArticleFromDoc(next, doc);
    if (activeId !== id) {
      article = shown;
      return;
    }
  }

  attachArticle(next);
  updateChromeForTab(next);
  renderOutline(next.outline || []);
  refreshTabSelection();
  if (tabs.size >= 2) {
    if (tabbar.hidden || tabbar.childElementCount !== tabs.size) renderTabbar();
    else refreshTabSelection();
  } else {
    renderTabbar();
  }

  if (restoreScroll) {
    previewScroll.scrollTop = next.scrollTop || 0;
  }

  if (findBar.classList.contains("visible") && findInput.value) {
    runFind(findInput.value);
  }

  requestAnimationFrame(() => {
    updateActiveHeading();
    updateProgress();
  });

  evictLiveTabsIfNeeded();
}

async function closeTab(id) {
  const tab = tabs.get(id);
  if (!tab) return;

  const idx = order.indexOf(id);
  closedStack.unshift(tab.path);
  if (closedStack.length > MAX_CLOSED_STACK) closedStack.length = MAX_CLOSED_STACK;

  try {
    await invoke("close_file", { path: tab.path });
  } catch (e) {
    console.error(e);
  }

  if (tab.el?.isConnected) tab.el.remove();
  releaseDiagrams(tab.el);
  tabs.delete(id);
  order = order.filter((x) => x !== id);
  lruOrder = lruOrder.filter((x) => x !== id);

  if (!tabs.size) {
    activeId = null;
    showEmpty();
    renderTabbar();
    return;
  }

  if (activeId === id) {
    const nextId = order[idx] || order[idx - 1] || order[0];
    activeId = null;
    await activateTab(nextId);
  } else {
    renderTabbar();
  }
}

function cycleTab(dir) {
  if (order.length < 2 || !activeId) return;
  const i = order.indexOf(activeId);
  const next = order[(i + dir + order.length) % order.length];
  void activateTab(next);
}

function goToTabIndex(n) {
  if (!order.length) return;
  const id = n >= order.length ? order[order.length - 1] : order[n];
  if (id) void activateTab(id);
}

async function reopenClosedTab() {
  const path = closedStack.shift();
  if (path) await openPath(path);
}

/* —— Documents —— */

function showEmpty() {
  if (article?.isConnected) article.remove();
  article = createArticleEl();
  article.hidden = true;
  empty.hidden = false;
  empty.classList.add("visible");
  if (!empty.isConnected) previewScroll.appendChild(empty);
  outlineList.innerHTML = "";
  outlineEmpty.hidden = true;
  pathLabel.textContent = "";
  pathDir.textContent = "";
  docTitle.title = "";
  currentPath = "";
  currentWordCount = 0;
  outline = [];
  updateStatus();
  void invoke("set_active", { title: null }).catch(() => {});
  renderRecent();
}

function applyDocToActiveTab(doc) {
  const tab = activeTab();
  if (!tab) return Promise.resolve();
  showError(null);
  fillArticleFromDoc(tab, doc);
  attachArticle(tab);
  updateChromeForTab(tab);
  renderOutline(tab.outline);
  clearFind();

  if (tab.path) {
    prefs.recent = [
      tab.path,
      ...(prefs.recent || []).filter((p) => !samePath(p, tab.path)),
    ].slice(0, 8);
  }

  // Two frames: the observer reports new diagrams after the first layout.
  const nextFrame = () => new Promise(requestAnimationFrame);
  return nextFrame()
    .then(nextFrame)
    .then(diagramsIdle)
    .then(() => {
      requestAnimationFrame(() => {
        updateActiveHeading();
        updateProgress();
      });
    });
}

async function openPath(path, force = false, { activate = true } = {}) {
  const existing = findTabByPath(path);
  if (existing) {
    if (activate) await activateTab(existing.id);
    return { path: existing.path, title: existing.title };
  }

  try {
    const doc = await invoke("open_file", { path, force });
    const id = `t${nextTabId++}`;
    const tab = {
      id,
      path: doc.path || path,
      title: doc.title || basename(doc.path || path),
      el: createArticleEl(),
      outline: doc.outline || [],
      wordCount: Number(doc.word_count) || 0,
      scrollTop: 0,
      force: !!force,
      stale: false,
    };

    const insertAt = activeId ? order.indexOf(activeId) + 1 : order.length;
    order.splice(insertAt, 0, id);
    tabs.set(id, tab);
    touchLru(id);

    const keepArticle = article;
    fillArticleFromDoc(tab, doc);

    if (activate) {
      if (activeTab()?.el?.isConnected) {
        activeTab().scrollTop = previewScroll.scrollTop;
        activeTab().el.remove();
      }
      activeId = id;
      attachArticle(tab);
      updateChromeForTab(tab);
      renderOutline(tab.outline);
      clearFind();
      previewScroll.scrollTop = 0;
      renderTabbar();
      try {
        prefs = (await invoke("get_prefs")) || prefs;
      } catch (_) {
        /* keep local */
      }
      renderRecent();
      evictLiveTabsIfNeeded();
      requestAnimationFrame(() => {
        updateActiveHeading();
        updateProgress();
      });
    } else {
      article = activeTab()?.el || keepArticle;
      renderTabbar();
    }
    return doc;
  } catch (e) {
    const msg = String(e);
    if (msg.includes("over 50 MB")) {
      if (confirm(`${msg}\n\nLoad anyway?`)) {
        return openPath(path, true, { activate });
      }
    }
    showError(msg);
    throw e;
  }
}

async function openMany(paths) {
  const list = (paths || []).filter(Boolean);
  if (!list.length) return;
  let lastOk = null;
  for (const path of list) {
    try {
      await openPath(path, false, { activate: false });
      lastOk = path;
    } catch (_) {
      /* error already shown */
    }
  }
  if (lastOk) {
    const tab = findTabByPath(lastOk);
    if (tab) await activateTab(tab.id);
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
  updateProgress();
}

async function reloadKeepingScroll(path) {
  const tab = path ? findTabByPath(path) : activeTab();
  if (!tab) return;

  if (tab.id !== activeId) {
    tab.stale = true;
    return;
  }

  const anchor = captureScrollAnchor();
  try {
    const doc = await invoke("reload", { path: tab.path });
    if (tab.id !== activeId || !tabs.has(tab.id)) {
      tab.stale = true;
      return;
    }
    const rendered = applyDocToActiveTab(doc);
    requestAnimationFrame(() => restoreScrollAnchor(anchor));
    await rendered;
    requestAnimationFrame(() => restoreScrollAnchor(anchor));
  } catch (e) {
    showError(String(e));
  }
}

/* —— Find (CSS Custom Highlight API) —— */

function clearFind() {
  findMatches = [];
  findIndex = -1;
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

function runFind(query) {
  clearFind();
  if (!query || article.hidden) return;
  if (!CSS.highlights) {
    findCount.textContent = "Unavailable";
    return;
  }

  const lower = query.toLowerCase();
  const ranges = [];
  for (const node of collectTextNodes(article)) {
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

/* —— Links (article and diagrams) —— */

function linkHref(a) {
  return a.getAttribute("href") || a.getAttributeNS(XLINK, "href") || "";
}

async function followLink(href) {
  if (href.startsWith("#")) {
    if (dialog.open) dialog.close();
    const el = document.getElementById(decodeURIComponent(href.slice(1)));
    if (el) el.scrollIntoView({ behavior: "smooth" });
    return;
  }

  if (/^(https?:|mailto:)/i.test(href)) {
    try {
      await openUrl(href);
    } catch (e) {
      showError(String(e));
    }
    return;
  }

  const pathPart = href.split("#")[0];
  if (/\.(md|markdown|mdx|txt)$/i.test(pathPart)) {
    try {
      const base = activeTab()?.path;
      if (!base) throw new Error("no file open");
      const abs = await invoke("resolve_relative", { base, rel: pathPart });
      if (dialog.open) dialog.close();
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
    return;
  }

  showError(`Can't open this link from the viewer: ${href}`);
}

function onLinkClick(ev) {
  const a = ev.target.closest("a");
  if (!a) return;
  const href = linkHref(a);
  if (!href) return;
  ev.preventDefault();
  void followLink(href);
}

previewScroll.addEventListener("click", onLinkClick);
dlgViewport.addEventListener("click", onLinkClick);

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

/* —— Title bar / shortcuts —— */

async function pickAndOpen() {
  try {
    const paths = await invoke("pick_files");
    if (paths?.length) await openMany(paths);
  } catch (e) {
    showError(String(e));
  }
}

$("btn-open").addEventListener("click", pickAndOpen);
$("btn-open-empty").addEventListener("click", pickAndOpen);
$("error-close").addEventListener("click", () => showError(null));

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

$("btn-theme").addEventListener("click", async () => {
  prefs.theme = prefs.theme === "dark" ? "light" : "dark";
  applyPrefs();
  await savePrefs();
  if (activeTab()?.el && !article.hidden) rescheduleVisibleDiagrams();
});

async function setZoom(next) {
  prefs.zoom = Math.min(2.5, Math.max(0.7, Math.round(next * 10) / 10));
  applyPrefs();
  updateStatus();
  await savePrefs();
}

zoomLabel.addEventListener("click", () => setZoom(1));
$("btn-zoom-in").addEventListener("click", () => setZoom((prefs.zoom || 1) + 0.1));
$("btn-zoom-out").addEventListener("click", () => setZoom((prefs.zoom || 1) - 0.1));

window.addEventListener("keydown", (ev) => {
  if (dialog.open) return;
  const mod = ev.ctrlKey || ev.metaKey;
  if (mod && ev.key.toLowerCase() === "o") {
    ev.preventDefault();
    pickAndOpen();
  } else if (mod && ev.key.toLowerCase() === "f") {
    ev.preventDefault();
    openFind();
  } else if (mod && ev.key.toLowerCase() === "w") {
    ev.preventDefault();
    if (activeId) void closeTab(activeId);
  } else if (mod && ev.key.toLowerCase() === "t" && ev.shiftKey) {
    ev.preventDefault();
    void reopenClosedTab();
  } else if (mod && (ev.key === "Tab" || ev.key === "PageDown" || ev.key === "PageUp")) {
    ev.preventDefault();
    cycleTab(ev.key === "PageUp" || (ev.key === "Tab" && ev.shiftKey) ? -1 : 1);
  } else if (mod && ev.key >= "1" && ev.key <= "9") {
    ev.preventDefault();
    if (ev.key === "9") goToTabIndex(order.length - 1);
    else goToTabIndex(Number(ev.key) - 1);
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
  prefs.sidebarWidth = clampSidebarWidth(ev.clientX - bounds.left);
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
  if (ev.key === "ArrowLeft" || ev.key === "ArrowRight") {
    ev.preventDefault();
    const dir = ev.key === "ArrowLeft" ? -1 : 1;
    prefs.sidebarWidth = clampSidebarWidth(prefs.sidebarWidth + dir * step);
    applySidebarWidth();
    savePrefs();
  }
});

previewScroll.addEventListener("scroll", onPreviewScroll, { passive: true });

window.addEventListener("resize", () => {
  applyPrefs();
  updateActiveHeading();
  updateProgress();
});

/* —— Boot —— */

async function consumePendingPaths() {
  try {
    const pending = await invoke("take_pending_paths");
    if (pending?.length) await openMany(pending);
  } catch (e) {
    showError(String(e));
  }
}

async function boot() {
  try {
    prefs = (await invoke("get_prefs")) || prefs;
  } catch (_) {
    /* defaults */
  }
  prefs.sidebarWidth = clampSidebarWidth(prefs.sidebarWidth ?? 248);
  prefs.recent = Array.isArray(prefs.recent) ? prefs.recent : [];
  applyPrefs();
  updateStatus();
  renderRecent();

  await listen("doc-changed", (ev) => {
    const path = typeof ev.payload === "string" ? ev.payload : "";
    void reloadKeepingScroll(path || undefined);
  });

  await listen("open-paths", () => {
    void consumePendingPaths();
  });

  try {
    const pending = await invoke("take_pending_paths");
    if (pending?.length) {
      await openMany(pending);
      return;
    }
  } catch (e) {
    showError(String(e));
  }

  showEmpty();
}

boot();
