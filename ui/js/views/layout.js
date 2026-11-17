import {
  DEFAULT_SIDEBAR_WIDTH,
  NARROW_BREAKPOINT,
  SIDEBAR_MAX,
  SIDEBAR_MIN,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_STEP,
} from "../core/constants.js";
import { $, btnOutline, main, resizer, zoomLabel } from "../core/dom.js";
import { setPrefs } from "../core/ipc.js";
import { activeTab, state } from "../core/state.js";
import { rescheduleVisibleDiagrams } from "../content/diagrams.js";
import { updateStatus } from "./status.js";

let narrowAutoCollapsed = false;
let resizing = false;

export function clampSidebarWidth(w) {
  const n = Number(w);
  if (!Number.isFinite(n)) return DEFAULT_SIDEBAR_WIDTH;
  return Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, Math.round(n)));
}

function applySidebarWidth() {
  const width = clampSidebarWidth(state.prefs.sidebarWidth);
  state.prefs.sidebarWidth = width;
  document.documentElement.style.setProperty("--sidebar-width", `${width}px`);
}

export function isNarrow() {
  return window.innerWidth < NARROW_BREAKPOINT;
}

export function applyPrefs() {
  const { prefs } = state;
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

export async function savePrefs() {
  try {
    await setPrefs(state.prefs);
  } catch (e) {
    console.error(e);
  }
}

export function initOutlineToggle() {
  btnOutline.addEventListener("click", async () => {
    if (isNarrow() && state.prefs.outlineOpen) {
      const opening = !main.classList.contains("outline-user-open") && narrowAutoCollapsed;
      if (opening) {
        main.classList.add("outline-user-open");
        narrowAutoCollapsed = false;
        btnOutline.setAttribute("aria-pressed", "true");
        return;
      }
    }
    state.prefs.outlineOpen = !state.prefs.outlineOpen;
    main.classList.remove("outline-user-open");
    applyPrefs();
    await savePrefs();
  });
}

export function initThemeToggle() {
  $("btn-theme").addEventListener("click", async () => {
    state.prefs.theme = state.prefs.theme === "dark" ? "light" : "dark";
    applyPrefs();
    await savePrefs();
    if (activeTab()?.el && !state.article.hidden) rescheduleVisibleDiagrams();
  });
}

export async function setZoom(next) {
  state.prefs.zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(next * 10) / 10));
  applyPrefs();
  updateStatus();
  await savePrefs();
}

export function initZoom() {
  zoomLabel.addEventListener("click", () => setZoom(1));
  $("btn-zoom-in").addEventListener("click", () => setZoom((state.prefs.zoom || 1) + ZOOM_STEP));
  $("btn-zoom-out").addEventListener("click", () => setZoom((state.prefs.zoom || 1) - ZOOM_STEP));
}

function onResizePointerMove(ev) {
  if (!resizing) return;
  const bounds = main.getBoundingClientRect();
  state.prefs.sidebarWidth = clampSidebarWidth(ev.clientX - bounds.left);
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

export function initResizer() {
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
      state.prefs.sidebarWidth = clampSidebarWidth(state.prefs.sidebarWidth + dir * step);
      applySidebarWidth();
      savePrefs();
    }
  });
}
