import { XLINK } from "../core/constants.js";
import { dialog, dlgViewport, previewScroll } from "../core/dom.js";
import { openUrl, resolveRelative } from "../core/ipc.js";
import { activeTab } from "../core/state.js";
import { showError } from "../widgets/banner.js";
import { openPath } from "./documents.js";

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
      const abs = await resolveRelative(base, pathPart);
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

export function initLinks() {
  previewScroll.addEventListener("click", onLinkClick);
  dlgViewport.addEventListener("click", onLinkClick);
}
