import { streamJsonl } from "./jsonl";
import { stripSystemTags } from "./systemTags";

export interface SessionMetadata {
  id: string;
  cwd: string;
  auto_title: string | null;
  created_at: number;
  last_active_at: number;
  message_count: number;
}

export interface ExtractOptions {
  fallbackEncodedDir?: string;
}

const TITLE_MAX = 80;

function decodeEncodedDir(encoded: string): string {
  // Claude Code replaces slashes with dashes; we make a best-effort decode.
  return "/" + encoded.replace(/^-/, "").replaceAll("-", "/");
}

const GRAPHEME_SEGMENTER =
  typeof Intl !== "undefined" && typeof Intl.Segmenter === "function"
    ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
    : null;

// Truncate by grapheme cluster, not code unit. A naive .slice(0, 80) can
// split a surrogate pair (emoji) or combining-mark sequence at the boundary
// and produce a malformed string.
export function truncateGraphemes(text: string, max: number): string {
  if (max <= 0) return "";
  if (!GRAPHEME_SEGMENTER) return text.slice(0, max);
  let out = "";
  let count = 0;
  for (const seg of GRAPHEME_SEGMENTER.segment(text)) {
    if (count >= max) break;
    out += seg.segment;
    count++;
  }
  return out;
}

function asText(content: unknown): string | null {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    for (const part of content) {
      if (part && typeof part === "object" && "text" in part) {
        const t = (part as { text: unknown }).text;
        if (typeof t === "string") return t;
      }
    }
  }
  return null;
}

export async function extractMetadata(
  filePath: string,
  id: string,
  opts: ExtractOptions = {},
): Promise<SessionMetadata> {
  let cwd: string | null = null;
  let autoTitle: string | null = null;
  let createdAt: number | null = null;
  let lastActiveAt: number | null = null;
  let messageCount = 0;

  for await (const rec of streamJsonl(filePath)) {
    const r = rec as Record<string, unknown>;
    const ts = typeof r.timestamp === "string" ? Date.parse(r.timestamp) : NaN;
    if (!Number.isNaN(ts)) {
      if (createdAt === null) createdAt = ts;
      lastActiveAt = ts;
    }
    if (cwd === null && typeof r.cwd === "string") {
      cwd = r.cwd;
    }
    if (r.type === "user" || r.type === "assistant") {
      messageCount++;
      if (autoTitle === null && r.type === "user") {
        const msg = r.message as { content?: unknown } | undefined;
        const text = asText(msg?.content);
        if (text) {
          const cleaned = stripSystemTags(text);
          if (cleaned) {
            autoTitle = truncateGraphemes(cleaned, TITLE_MAX);
          }
        }
      }
    }
  }

  const resolvedCwd =
    cwd ??
    (opts.fallbackEncodedDir ? decodeEncodedDir(opts.fallbackEncodedDir) : null);

  if (resolvedCwd === null) {
    throw new Error(
      `extractMetadata: no cwd in JSONL and no fallbackEncodedDir provided for ${filePath}`,
    );
  }

  return {
    id,
    cwd: resolvedCwd,
    auto_title: autoTitle,
    created_at: createdAt ?? 0,
    last_active_at: lastActiveAt ?? 0,
    message_count: messageCount,
  };
}
