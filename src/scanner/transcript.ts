import { streamJsonl } from "./jsonl";
import { SYSTEM_TAG_RE } from "./systemTags";

export type TranscriptBlock =
  | { kind: "text"; text: string }
  | { kind: "thinking"; text: string }
  | { kind: "tool_use"; id: string; name: string; input: unknown }
  | {
      kind: "tool_result";
      toolUseId: string;
      content: string;
      isError: boolean;
    };

export interface TranscriptMessage {
  type: "user" | "assistant";
  blocks: TranscriptBlock[];
  timestamp: number;
}

function clean(text: string): string {
  return text.replace(SYSTEM_TAG_RE, "").trim();
}

function toolResultContentAsText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const c of content) {
      if (c && typeof c === "object" && "text" in c) {
        const t = (c as { text: unknown }).text;
        if (typeof t === "string") parts.push(t);
      }
    }
    return parts.join("\n");
  }
  return "";
}

function blocksFromContent(content: unknown): TranscriptBlock[] {
  const out: TranscriptBlock[] = [];
  if (typeof content === "string") {
    const c = clean(content);
    if (c) out.push({ kind: "text", text: c });
    return out;
  }
  if (!Array.isArray(content)) return out;
  for (const part of content) {
    if (!part || typeof part !== "object") continue;
    const p = part as Record<string, unknown>;
    if (p.type === "text" && typeof p.text === "string") {
      const c = clean(p.text);
      if (c) out.push({ kind: "text", text: c });
    } else if (p.type === "thinking" && typeof p.thinking === "string") {
      const t = p.thinking.trim();
      if (t) out.push({ kind: "thinking", text: t });
    } else if (p.type === "tool_use") {
      out.push({
        kind: "tool_use",
        id: typeof p.id === "string" ? p.id : "",
        name: typeof p.name === "string" ? p.name : "?",
        input: p.input,
      });
    } else if (p.type === "tool_result") {
      out.push({
        kind: "tool_result",
        toolUseId: typeof p.tool_use_id === "string" ? p.tool_use_id : "",
        content: toolResultContentAsText(p.content),
        isError: Boolean(p.is_error),
      });
    }
  }
  return out;
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
    const blocks = blocksFromContent(msg?.content);
    if (blocks.length === 0) continue;
    const ts = typeof r.timestamp === "string" ? Date.parse(r.timestamp) : 0;
    out.push({
      type: r.type === "user" ? "user" : "assistant",
      blocks,
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
