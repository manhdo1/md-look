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

/** Strip Windows verbatim prefixes so `\\?\UNC\host\x` matches `\\host\x`. */
function stripVerbatimForCompare(path) {
  let n = path.replace(/\\/g, "/");
  const lower = n.toLowerCase();
  if (lower.startsWith("//?/unc/")) {
    n = `//${n.slice("//?/unc/".length)}`;
  } else if (n.startsWith("//?/")) {
    n = n.slice("//?/".length);
  }
  return n;
}

/** Case-insensitive path compare for Windows (incl. `\\?\` / `\\?\UNC\` forms). */
export function samePath(a, b) {
  if (!a || !b) return false;
  const na = stripVerbatimForCompare(a);
  const nb = stripVerbatimForCompare(b);
  return na.toLowerCase() === nb.toLowerCase();
}
