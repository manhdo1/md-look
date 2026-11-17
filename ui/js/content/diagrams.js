import { INLINE_MIN_SCALE } from "../core/constants.js";
import { previewScroll } from "../core/dom.js";
import { state } from "../core/state.js";
import { icon } from "../core/icons.js";
import { copyButton } from "../widgets/clipboard.js";
import { isMermaidBlock } from "./code-blocks.js";
import { PanZoom, runPanZoomAction } from "./panzoom.js";
import { currentTheme, diagramKind, renderMermaidInto } from "./mermaid.js";
import { openDiagramDialog } from "./diagram-dialog.js";

const diagramHeights = new Map();
/** @type {Set<HTMLElement>} */
const diagramQueue = new Set();
let diagramWorker = null;
/** @type {IntersectionObserver} */
let diagramObserver = null;
/** Called after a diagram switches between Diagram and Source view. */
let onViewChange = () => {};

export function initDiagrams({ onViewChange: viewChanged } = {}) {
  if (viewChanged) onViewChange = viewChanged;
  /** Draw diagrams only when they come within one screen of the reader's viewport. */
  diagramObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        entry.target._near = entry.isIntersecting;
        if (entry.isIntersecting) scheduleDiagram(entry.target);
      }
    },
    { root: previewScroll, rootMargin: "100% 0px" }
  );
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
    if (!runPanZoomAction(pz, act) && act === "expand") openDiagramDialog(dg);
  });

  let lastWidth = 0;
  dg._ro = new ResizeObserver(() => {
    const width = viewport.clientWidth;
    if (!width || width === lastWidth || !pz.w) return;
    lastWidth = width;
    sizeViewport(dg);
    if (!pz.userMoved) pz.fit();
  });
  dg._ro.observe(viewport);

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
  onViewChange();
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

export function prepareDiagrams() {
  const out = [];
  state.article.querySelectorAll("pre > code").forEach((code) => {
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
export function releaseDiagrams(root) {
  root?.querySelectorAll(".diagram").forEach((dg) => {
    diagramObserver.unobserve(dg);
    diagramQueue.delete(dg);
    dg._ro?.disconnect();
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
export function diagramsIdle() {
  return diagramWorker ? diagramWorker.then(diagramsIdle) : Promise.resolve();
}

/** Re-queue on-screen diagrams of the active article (theme change). */
export function rescheduleVisibleDiagrams() {
  state.article.querySelectorAll(".diagram").forEach((dg) => {
    if (dg._near) scheduleDiagram(dg);
  });
}
