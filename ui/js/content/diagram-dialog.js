import { dialog, dlgCanvas, dlgHint, dlgTitle, dlgViewport, dlgZoom, previewScroll, reloadToast } from "../core/dom.js";
import { state } from "../core/state.js";
import { PanZoom, runPanZoomAction } from "./panzoom.js";
import { diagramKind, renderMermaidInto } from "./mermaid.js";
import { showError } from "../widgets/banner.js";
import { showUpdatedToast } from "../widgets/toast.js";

const DIAGRAM_HINT = "Scroll to zoom · drag to pan · double-click to fit";
const IMAGE_HINT = "Scroll to zoom · drag to pan · Esc to close";
const SVG_FALLBACK = { w: 800, h: 600 };

/** @type {PanZoom} */
let dialogPz = null;

function imageTitle(img) {
  const alt = (img.getAttribute("alt") || "").trim();
  if (alt) return alt;
  const src = img.currentSrc || img.getAttribute("src") || "";
  if (!src) return "Image";
  try {
    const path = decodeURIComponent(src.split(/[?#]/)[0]);
    return path.split(/[/\\]/).pop() || "Image";
  } catch {
    return "Image";
  }
}

function imageSize(img) {
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  if (w > 0 && h > 0) return { w, h };
  return SVG_FALLBACK;
}

function fitImageInDialog(img) {
  const { w, h } = imageSize(img);
  dialogPz.setContent(w, h);
  requestAnimationFrame(() => dialogPz.fit());
}

export async function openDiagramDialog(dg) {
  const source = dg.dataset.source;
  const kind = diagramKind(source);
  dlgTitle.textContent = kind ? `${kind[0].toUpperCase()}${kind.slice(1)} diagram` : "Diagram";
  dialog.setAttribute("aria-label", "Diagram");
  if (dlgHint) dlgHint.textContent = DIAGRAM_HINT;
  dlgCanvas.innerHTML = "";
  dialog.showModal();
  reloadToast?.classList.remove("visible");
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

/** Open the shared diagram dialog with a cloned article image for pan/zoom. */
export function openImageDialog(img) {
  if (!img || !dialogPz) return;
  dlgTitle.textContent = imageTitle(img);
  dialog.setAttribute("aria-label", "Image");
  if (dlgHint) dlgHint.textContent = IMAGE_HINT;
  dlgCanvas.innerHTML = "";

  const clone = /** @type {HTMLImageElement} */ (img.cloneNode(true));
  clone.removeAttribute("width");
  clone.removeAttribute("height");
  clone.style.maxWidth = "none";
  clone.style.width = "auto";
  clone.style.height = "auto";
  clone.style.cursor = "default";
  clone.draggable = false;
  dlgCanvas.appendChild(clone);

  dialog.showModal();
  reloadToast?.classList.remove("visible");

  if (clone.complete) {
    fitImageInDialog(clone);
  } else {
    clone.addEventListener(
      "load",
      () => {
        if (!dialog.open || !clone.isConnected) return;
        fitImageInDialog(clone);
      },
      { once: true }
    );
    clone.addEventListener(
      "error",
      () => {
        if (!dialog.open || !clone.isConnected) return;
        fitImageInDialog(clone);
      },
      { once: true }
    );
  }
}

function onArticleImageClick(ev) {
  const img = ev.target.closest?.("img");
  if (!img) return;
  if (!img.closest("#article")) return;
  if (img.closest("a")) return;
  if (img.closest(".diagram, .dg-canvas")) return;
  ev.preventDefault();
  openImageDialog(img);
}

export function initDiagramDialog() {
  dialogPz = new PanZoom(dlgViewport, dlgCanvas, {
    wheelZoom: true,
    maxFit: 2,
    onChange: (s) => (dlgZoom.textContent = `${Math.round(s * 100)}%`),
  });

  dialog.addEventListener("close", () => {
    dlgCanvas.innerHTML = "";
    if (!state.toastAfterDialog) return;
    state.toastAfterDialog = false;
    setTimeout(() => showUpdatedToast(), 100);
  });

  dialog.querySelector(".dg-tools").addEventListener("click", (e) => {
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (!runPanZoomAction(dialogPz, act) && act === "close") dialog.close();
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

  previewScroll.addEventListener("click", onArticleImageClick);
}
