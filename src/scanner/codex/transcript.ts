import { streamJsonl } from "../jsonl";
import type { TranscriptBlock, TranscriptMessage } from "../transcript";

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

function clean(text: string): string {
  return text.replace(CODEX_NOISE_RE, "").trim();
}

function textFromContent(content: unknown, kinds: string[]): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
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
  return parts.join("\n");
}

function reasoningText(payload: Record<string, unknown>): string {
  // Codex reasoning records carry both a structured `summary` (array of
  // {type: "summary_text", text}) and a plain-text `content` array. Prefer
  // summary when present; fall back to content text.
  const summary = payload.summary;
  if (Array.isArray(summary) && summary.length > 0) {
    const parts: string[] = [];
    for (const s of summary) {
      if (s && typeof s === "object") {
        const t = (s as { text?: unknown }).text;
        if (typeof t === "string") parts.push(t);
      }
    }
    if (parts.length > 0) return parts.join("\n");
  }
  return textFromContent(payload.content, ["reasoning_text", "text"]);
}

function blocksFromMessage(payload: Record<string, unknown>): TranscriptBlock[] {
  const out: TranscriptBlock[] = [];
  if (payload.role === "user") {
    const text = textFromContent(payload.content, ["input_text", "text"]);
    const cleaned = clean(text);
    if (cleaned) out.push({ kind: "text", text: cleaned });
    return out;
  }
  if (payload.role === "assistant") {
    const text = textFromContent(payload.content, ["output_text", "text"]);
    if (text.trim()) out.push({ kind: "text", text: text.trim() });
    return out;
  }
  // Skip developer/system roles — Codex uses them to inject permissions and
  // tool docs the user never wrote.
  return out;
}

function parseFunctionCallInput(args: unknown): unknown {
  if (typeof args !== "string") return args;
  try {
    return JSON.parse(args);
  } catch {
    return args;
  }
}

export async function readCodexTranscript(
  filePath: string,
  limit?: number,
): Promise<TranscriptMessage[]> {
  const out: TranscriptMessage[] = [];

  for await (const rec of streamJsonl(filePath)) {
    const r = rec as Record<string, unknown>;
    if (r.type !== "response_item") continue;
    const payload = r.payload as Record<string, unknown> | undefined;
    if (!payload) continue;

    const ts = typeof r.timestamp === "string" ? Date.parse(r.timestamp) : 0;
    const timestamp = Number.isNaN(ts) ? 0 : ts;

    if (payload.type === "message") {
      const blocks = blocksFromMessage(payload);
      if (blocks.length === 0) continue;
      const role = payload.role === "user" ? "user" : "assistant";
      out.push({ type: role, blocks, timestamp });
    } else if (payload.type === "reasoning") {
      const text = reasoningText(payload);
      if (text.trim()) {
        out.push({
          type: "assistant",
          blocks: [{ kind: "thinking", text: text.trim() }],
          timestamp,
        });
      }
    } else if (payload.type === "function_call") {
      const id = typeof payload.call_id === "string" ? payload.call_id : "";
      const name = typeof payload.name === "string" ? payload.name : "?";
      out.push({
        type: "assistant",
        blocks: [
          {
            kind: "tool_use",
            id,
            name,
            input: parseFunctionCallInput(payload.arguments),
          },
        ],
        timestamp,
      });
    } else if (payload.type === "function_call_output") {
      const id = typeof payload.call_id === "string" ? payload.call_id : "";
      const output =
        typeof payload.output === "string" ? payload.output : "";
      out.push({
        type: "user",
        blocks: [
          {
            kind: "tool_result",
            toolUseId: id,
            content: output,
            isError: false,
          },
        ],
        timestamp,
      });
    }

    if (limit !== undefined && out.length > limit * 2) {
      out.splice(0, out.length - limit);
    }
  }

  if (limit !== undefined && out.length > limit) {
    return out.slice(out.length - limit);
  }
  return out;
}
