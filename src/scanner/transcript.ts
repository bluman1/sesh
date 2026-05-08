import { streamJsonl } from "./jsonl";

export interface TranscriptMessage {
  type: "user" | "assistant";
  text: string;
  timestamp: number;
}

const SYSTEM_TAG_RE = /<(system-reminder|command-name|command-message|command-args|env|local-command-stdout|local-command-stderr|ide_selection|ide_diagnostics)>[\s\S]*?<\/\1>/g;

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
    if (limit !== undefined && out.length >= limit) break;
  }
  return out;
}
