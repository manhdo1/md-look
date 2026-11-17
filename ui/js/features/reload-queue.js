import { checkChangedPaths } from "../core/ipc.js";
import { state } from "../core/state.js";
import { markBackgroundChanged } from "../views/tabbar.js";

/**
 * One reload at a time per tab. A second request sets `again` and the owner
 * runs a single follow-up after the in-flight invoke finishes.
 */
export function withTabReload(tab, { toast = false } = {}, body) {
  const { reloads, tabs } = state;
  const existing = reloads.get(tab.id);
  if (existing) {
    existing.again = true;
    if (toast) existing.toast = true;
    return existing.done;
  }
  let resolveDone;
  const done = new Promise((resolve) => {
    resolveDone = resolve;
  });
  const job = { again: false, toast: !!toast, done };
  reloads.set(tab.id, job);
  return (async () => {
    try {
      let followUp = false;
      do {
        const showToast = job.toast;
        job.toast = false;
        job.again = false;
        // The watcher and the poll often report the same save; skip the second
        // full render when the first reload already picked it up.
        if (followUp && !(await hasPendingChange(tab))) break;
        followUp = true;
        await body({ toast: showToast });
      } while (job.again && tabs.has(tab.id) && tab.id === state.activeId);
      if (job.again && tabs.has(tab.id)) markBackgroundChanged(tab);
    } finally {
      reloads.delete(tab.id);
      resolveDone();
    }
  })();
}

async function hasPendingChange(tab) {
  try {
    const changed = await checkChangedPaths([tab.path]);
    return !Array.isArray(changed) || changed.length > 0;
  } catch (_) {
    return true;
  }
}
