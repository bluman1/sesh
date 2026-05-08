import { streamJsonl } from "./jsonl";
import { SYSTEM_TAG_RE } from "./systemTags";

export interface TranscriptMessage {
  type: "user" | "assistant";
  text: string;
  timestamp: number;
}

function asText(content: unknown): string | null {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const part of content) {
      if (part && typeof part === "object" && "text" in part) {
        const t = (part as { text: unknown }).text;
        if (typeof t === "string") parts.push(t);
      }
    }
    return parts.length ? parts.join("\n") : null;
  }
  return null;
}

/**
 * Reads the JSONL and returns transcript messages.
 *
 * When `limit` is provided, returns the **last** `limit` messages (the most
 * recent ones). The previous behaviour returned the first N which hid the
 * tail of long sessions — typically what the user actually wants to see when
 * they open a session.
 */
export async function readTranscript(
  filePath: string,
  limit?: number,
): Promise<TranscriptMessage[]> {
  const out: TranscriptMessage[] = [];
  for await (const rec of streamJsonl(filePath)) {
    const r = rec as Record<string, unknown>;
    if (r.type !== "user" && r.type !== "assistant") continue;
    const msg = r.message as { content?: unknown } | undefined;
    const raw = asText(msg?.content);
    if (raw === null) continue;
    const cleaned = raw.replace(SYSTEM_TAG_RE, "").trim();
    if (!cleaned) continue;
    const ts = typeof r.timestamp === "string" ? Date.parse(r.timestamp) : 0;
    out.push({
      type: r.type === "user" ? "user" : "assistant",
      text: cleaned,
      timestamp: Number.isNaN(ts) ? 0 : ts,
    });
    // Keep memory bounded to roughly 2*limit while streaming; trim later.
    if (limit !== undefined && out.length > limit * 2) {
      out.splice(0, out.length - limit);
    }
  }
  if (limit !== undefined && out.length > limit) {
    return out.slice(out.length - limit);
  }
  return out;
}
