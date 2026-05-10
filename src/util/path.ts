/**
 * Last segment of a slash-separated path. Returns null for empty input
 * or paths whose final segment is blank. Tolerant of trailing slashes.
 */
export function basename(p: string | null | undefined): string | null {
  if (!p) return null;
  const trimmed = p.replace(/\/+$/, "");
  const idx = trimmed.lastIndexOf("/");
  const tail = idx >= 0 ? trimmed.slice(idx + 1) : trimmed;
  return tail.length > 0 ? tail : null;
}
