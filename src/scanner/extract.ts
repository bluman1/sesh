import { streamJsonl } from "./jsonl";
import { stripSystemTags } from "./systemTags";

export interface SessionTokens {
  tokens_in: number;
  tokens_out: number;
  tokens_cache_read: number;
  tokens_cache_create: number;
}

export interface SessionMetadata {
  id: string;
  cwd: string;
  auto_title: string | null;
  created_at: number;
  last_active_at: number;
  message_count: number;
  tokens: SessionTokens;
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
  let firstPromptTitle: string | null = null;
  let aiTitle: string | null = null;
  let createdAt: number | null = null;
  let lastActiveAt: number | null = null;
  let messageCount = 0;
  const tokens: SessionTokens = {
    tokens_in: 0,
    tokens_out: 0,
    tokens_cache_read: 0,
    tokens_cache_create: 0,
  };

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
    // Claude Code emits `ai-title` records continuously through the
    // session, but in practice the value never changes once set. Take
    // the first one we see — first-write wins.
    if (
      aiTitle === null &&
      r.type === "ai-title" &&
      typeof r.aiTitle === "string" &&
      r.aiTitle.trim()
    ) {
      aiTitle = truncateGraphemes(r.aiTitle.trim(), TITLE_MAX);
    }
    if (r.type === "user" || r.type === "assistant") {
      messageCount++;
      if (firstPromptTitle === null && r.type === "user") {
        const msg = r.message as { content?: unknown } | undefined;
        const text = asText(msg?.content);
        if (text) {
          const cleaned = stripSystemTags(text);
          if (cleaned) {
            firstPromptTitle = truncateGraphemes(cleaned, TITLE_MAX);
          }
        }
      }
      if (r.type === "assistant") {
        const msg = r.message as { usage?: unknown } | undefined;
        const usage = msg?.usage as Record<string, unknown> | undefined;
        if (usage) {
          tokens.tokens_in += numberOrZero(usage.input_tokens);
          tokens.tokens_out += numberOrZero(usage.output_tokens);
          tokens.tokens_cache_read += numberOrZero(usage.cache_read_input_tokens);
          tokens.tokens_cache_create += numberOrZero(
            usage.cache_creation_input_tokens,
          );
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
    // Claude Code's own ai-title is much better than our first-prompt
    // truncation when it exists. Fall back to first-prompt for very short
    // sessions that didn't accumulate enough turns to trigger title gen.
    auto_title: aiTitle ?? firstPromptTitle,
    created_at: createdAt ?? 0,
    last_active_at: lastActiveAt ?? 0,
    message_count: messageCount,
    tokens,
  };
}

function numberOrZero(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
