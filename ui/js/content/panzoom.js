export class PanZoom {
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

/** Toolbar actions shared by inline diagrams and the dialog; false when `act` is not one of them. */
export function runPanZoomAction(pz, act) {
  if (act === "zoom-in") pz.zoomBy(1.25);
  else if (act === "zoom-out") pz.zoomBy(0.8);
  else if (act === "fit") pz.fit(true);
  else if (act === "reset") pz.actualSize();
  else return false;
  return true;
}
