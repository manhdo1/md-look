import { icon } from "../core/icons.js";
import { showError } from "./banner.js";

export async function copyText(text, btn) {
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

export function copyButton(getText, label = "Copy") {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "text-btn";
  btn.title = "Copy to clipboard";
  btn.innerHTML = `${icon("copy")}<span>${label}</span>`;
  btn.addEventListener("click", () => copyText(getText(), btn));
  return btn;
}
