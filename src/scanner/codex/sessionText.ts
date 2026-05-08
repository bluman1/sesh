import { streamJsonl } from "../jsonl";

const CODEX_NOISE_TAGS = [
  "environment_context",
  "permissions instructions",
  "tools",
  "user_instructions",
];
const CODEX_NOISE_RE = new RegExp(
  `<(${CODEX_NOISE_TAGS.map((t) => t.replace(/\s/g, "\\s")).join("|")})[\\s\\S]*?<\\/\\1>`,
  "g",
);

function pluck(content: unknown, kinds: string[]): string | null {
  if (!Array.isArray(content)) return null;
  const parts: string[] = [];
  for (const part of content) {
    if (!part || typeof part !== "object") continue;
    const p = part as Record<string, unknown>;
    if (
      kinds.includes(typeof p.type === "string" ? p.type : "") &&
      typeof p.text === "string"
    ) {
      parts.push(p.text);
    }
  }
  return parts.length ? parts.join("\n") : null;
}

// Yields user/assistant message text for FTS indexing of Codex sessions.
// Skips developer/system roles, function_call_output (very noisy and per-tool
// logs), and reasoning blocks (kept out of FTS to match Claude's content
// indexer which excludes thinking too).
export async function* streamCodexSessionText(
  filePath: string,
): AsyncIterable<string> {
  for await (const rec of streamJsonl(filePath)) {
    const r = rec as Record<string, unknown>;
    if (r.type !== "response_item") continue;
    const payload = r.payload as Record<string, unknown> | undefined;
    if (!payload || payload.type !== "message") continue;
    if (payload.role !== "user" && payload.role !== "assistant") continue;
    const kinds =
      payload.role === "user" ? ["input_text", "text"] : ["output_text", "text"];
    const text = pluck(payload.content, kinds);
    if (!text) continue;
    const cleaned = text.replace(CODEX_NOISE_RE, "").trim();
    if (cleaned) yield cleaned;
  }
}
