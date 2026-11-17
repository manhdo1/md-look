import { SVG_CACHE_MAX } from "../core/constants.js";
import { LruCache } from "../core/lru.js";

const svgCache = new LruCache(SVG_CACHE_MAX);
let mermaidSeq = 0;
let mermaidTheme = null;
/** @type {Promise<boolean> | null} */
let mermaidLoad = null;

/** The 2.6 MB bundle costs ~250 ms of main thread, so it loads with the first diagram, not at startup. */
function loadMermaid() {
  if (window.mermaid) return Promise.resolve(true);
  if (!mermaidLoad) {
    mermaidLoad = new Promise((resolve) => {
      const script = document.createElement("script");
      script.src = "vendor/mermaid.min.js";
      script.onload = () => resolve(Boolean(window.mermaid));
      script.onerror = () => {
        console.error("mermaid failed to load");
        script.remove();
        mermaidLoad = null;
        resolve(false);
      };
      document.head.appendChild(script);
    });
  }
  return mermaidLoad;
}

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

export function diagramKind(source) {
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

export function currentTheme() {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

/** Re-initialize Mermaid only when the theme it was configured for changes. */
async function ensureMermaid() {
  if (!(await loadMermaid())) return false;
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
  if (cached) return cached;
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
  return entry;
}

export async function renderMermaidInto(canvas, source) {
  if (!(await ensureMermaid())) return null;
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
