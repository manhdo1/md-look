const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;
export const { openUrl } = window.__TAURI__.opener;

export const openFile = (path, force) => invoke("open_file", { path, force });
export const reloadFile = (path) => invoke("reload", { path });
export const checkChangedPaths = (paths) => invoke("check_changed", { paths });
export const closeFile = (path) => invoke("close_file", { path });
export const setActive = (title) => invoke("set_active", { title });
export const getPrefs = () => invoke("get_prefs");
export const setPrefs = (prefs) => invoke("set_prefs", { prefs });
export const pickFiles = () => invoke("pick_files");
export const resolveRelative = (base, rel) => invoke("resolve_relative", { base, rel });
export const takePendingPaths = () => invoke("take_pending_paths");

/** `{ path, missing }` (or a bare path string) after a watched file settles. */
export const onDocChanged = (handler) => listen("doc-changed", handler);
/** Paths were queued; drain them with `takePendingPaths`. */
export const onOpenPaths = (handler) => listen("open-paths", handler);
