import { recentList, recentWrap } from "../core/dom.js";
import { basename, dirname } from "../core/paths.js";
import { state } from "../core/state.js";
import { savePrefs } from "./layout.js";

/** Opens a recent path; rejects when it can no longer be opened. */
let openRecent = async () => {};

export function initRecent({ open }) {
  openRecent = open;
}

export function renderRecent() {
  const items = Array.isArray(state.prefs.recent) ? state.prefs.recent : [];
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
        await openRecent(path);
      } catch (_) {
        state.prefs.recent = (state.prefs.recent || []).filter((p) => p !== path);
        await savePrefs();
        renderRecent();
      }
    });
    li.appendChild(btn);
    recentList.appendChild(li);
  }
}
