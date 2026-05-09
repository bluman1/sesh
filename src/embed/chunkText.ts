const DEFAULT_MAX = 512;
const DEFAULT_OVERLAP = 64;

/**
 * Split text into overlapping chunks of at most `maxChars` characters,
 * preferring sentence boundaries when possible. Adjacent chunks share
 * `overlap` characters of context.
 */
export function chunkText(
  text: string,
  opts?: { maxChars?: number; overlap?: number },
): string[] {
  const max = opts?.maxChars ?? DEFAULT_MAX;
  const overlap = opts?.overlap ?? DEFAULT_OVERLAP;
  const trimmed = text.trim();
  if (trimmed.length === 0) return [];
  if (trimmed.length <= max) return [trimmed];

  const out: string[] = [];
  let start = 0;
  while (start < trimmed.length) {
    let end = Math.min(start + max, trimmed.length);
    if (end < trimmed.length) {
      // Prefer the last sentence boundary in [start, end].
      const slice = trimmed.slice(start, end);
      const lastSentence = Math.max(
        slice.lastIndexOf(". "),
        slice.lastIndexOf("! "),
        slice.lastIndexOf("? "),
        slice.lastIndexOf("\n"),
      );
      if (lastSentence > max * 0.4) {
        end = start + lastSentence + 1; // include the punctuation
      }
    }
    out.push(trimmed.slice(start, end).trim());
    if (end >= trimmed.length) break;
    start = Math.max(end - overlap, start + 1);
  }
  return out;
}
