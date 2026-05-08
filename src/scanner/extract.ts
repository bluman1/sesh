import { streamJsonl } from "./jsonl";

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
          autoTitle = text.slice(0, TITLE_MAX);
        }
      }
    }
  }

  return {
    id,
    cwd: cwd ?? (opts.fallbackEncodedDir ? decodeEncodedDir(opts.fallbackEncodedDir) : ""),
    auto_title: autoTitle,
    created_at: createdAt ?? 0,
    last_active_at: lastActiveAt ?? 0,
    message_count: messageCount,
  };
}
