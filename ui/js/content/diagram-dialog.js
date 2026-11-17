import { dialog, dlgCanvas, dlgTitle, dlgViewport, dlgZoom, reloadToast } from "../core/dom.js";
import { state } from "../core/state.js";
import { PanZoom, runPanZoomAction } from "./panzoom.js";
import { diagramKind, renderMermaidInto } from "./mermaid.js";
import { showError } from "../widgets/banner.js";
import { showUpdatedToast } from "../widgets/toast.js";

/** @type {PanZoom} */
let dialogPz = null;

export async function openDiagramDialog(dg) {
  const source = dg.dataset.source;
  const kind = diagramKind(source);
  dlgTitle.textContent = kind ? `${kind[0].toUpperCase()}${kind.slice(1)} diagram` : "Diagram";
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
}
