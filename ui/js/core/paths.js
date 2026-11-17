export function basename(path) {
  const normalized = path.replace(/\\/g, "/");
  const i = normalized.lastIndexOf("/");
  return i >= 0 ? normalized.slice(i + 1) : normalized;
}

export function dirname(path) {
  const normalized = path.replace(/\\/g, "/");
  const i = normalized.lastIndexOf("/");
  return i >= 0 ? normalized.slice(0, i) : "";
}

export function parentBasename(path) {
  const dir = dirname(path);
  if (!dir) return "";
  return basename(dir);
}

/** Case-insensitive path compare for Windows. */
export function samePath(a, b) {
  if (!a || !b) return false;
  const na = a.replace(/\\/g, "/");
  const nb = b.replace(/\\/g, "/");
  return na.toLowerCase() === nb.toLowerCase();
}
