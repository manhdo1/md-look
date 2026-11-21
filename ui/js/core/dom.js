export const $ = (id) => document.getElementById(id);

export const empty = $("empty");
export const outlineList = $("outline-list");
export const outlineEmpty = $("outline-empty");
export const pathLabel = $("path-label");
export const pathDir = $("path-dir");
export const docTitle = $("doc-title");
export const errorBanner = $("error-banner");
export const errorText = $("error-text");
export const previewScroll = $("preview-scroll");
export const main = $("main");
export const findBar = $("find-bar");
export const findInput = $("find-input");
export const findCount = $("find-count");
export const zoomLabel = $("zoom-label");
export const wordCountEl = $("word-count");
export const encodingWarningEl = $("encoding-warning");
export const progressEl = $("read-progress");
export const sectionEl = $("status-section");
export const statusbar = $("statusbar");
export const reloadToast = $("reload-toast");
export const errorClose = $("error-close");
export const recentWrap = $("recent");
export const recentList = $("recent-list");
export const resizer = $("resizer");
export const btnOutline = $("btn-outline");
export const dialog = $("diagram-dialog");
export const tabbar = $("tabbar");

export const dlgViewport = dialog.querySelector(".dg-viewport");
export const dlgCanvas = dialog.querySelector(".dg-canvas");
export const dlgZoom = dialog.querySelector(".dg-zoom");
export const dlgTitle = dialog.querySelector(".dlg-title");
export const dlgHint = dialog.querySelector(".dlg-hint");

export function createArticleEl() {
  const el = document.createElement("article");
  el.id = "article";
  el.hidden = true;
  return el;
}
