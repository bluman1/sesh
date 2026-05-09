import { streamJsonl } from "./jsonl";
import type { TurnRow } from "../db/turns";
import type { ToolCallRow } from "../db/toolCalls";

const CORRECTION_MARKERS = /^(no|wrong|nope|stop|actually|instead|don'?t|that's wrong|that is wrong)\b/i;

const FILE_PATH_TOOLS = new Set(["Edit", "Write", "Read", "NotebookEdit"]);

export interface ExtractTurnsResult {
  turns: TurnRow[];
  toolCalls: ToolCallRow[];
}

function asJoinedText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const part of content) {
      if (part && typeof part === "object" && "type" in part) {
        const p = part as { type: string; text?: unknown };
        if (p.type === "text" && typeof p.text === "string") parts.push(p.text);
      }
    }
    return parts.join("\n");
  }
  return "";
}

function extractToolCalls(
  content: unknown,
  turnId: string,
  sessionId: string,
  ts: number,
): ToolCallRow[] {
  if (!Array.isArray(content)) return [];
  const out: ToolCallRow[] = [];
  for (const part of content) {
    if (!part || typeof part !== "object") continue;
    const p = part as { type: string; id?: unknown; name?: unknown; input?: unknown };
    if (p.type !== "tool_use") continue;
    if (typeof p.id !== "string" || typeof p.name !== "string") continue;
    let targetPath: string | null = null;
    if (FILE_PATH_TOOLS.has(p.name) && p.input && typeof p.input === "object") {
      const input = p.input as Record<string, unknown>;
      const fp = input.file_path ?? input.notebook_path;
      if (typeof fp === "string") targetPath = fp;
    }
    out.push({
      id: p.id,
      turn_id: turnId,
      session_id: sessionId,
      name: p.name,
      target_path: targetPath,
      is_error: 0,
      result_size: 0,
      ts,
    });
  }
  return out;
}

function numberOrZero(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

export async function extractTurns(
  filePath: string,
  sessionId: string,
): Promise<ExtractTurnsResult> {
  const turns: TurnRow[] = [];
  const toolCalls: ToolCallRow[] = [];
  let seq = 0;
  let prevTs: number | null = null;
  let lastAssistantTs: number | null = null;

  for await (const rec of streamJsonl(filePath)) {
    const r = rec as Record<string, unknown>;
    if (r.type !== "user" && r.type !== "assistant") continue;
    if (typeof r.uuid !== "string") continue;

    const ts = typeof r.timestamp === "string" ? Date.parse(r.timestamp) : NaN;
    if (Number.isNaN(ts)) continue;

    const role = r.type as "user" | "assistant";
    const msg = r.message as
      | { content?: unknown; model?: unknown; usage?: unknown }
      | undefined;
    const text = asJoinedText(msg?.content);

    let model: string | null = null;
    let tokens_in = 0,
      tokens_out = 0,
      tokens_cache_read = 0,
      tokens_cache_create = 0;
    if (role === "assistant") {
      if (typeof msg?.model === "string") model = msg.model;
      const usage = msg?.usage as Record<string, unknown> | undefined;
      if (usage) {
        tokens_in = numberOrZero(usage.input_tokens);
        tokens_out = numberOrZero(usage.output_tokens);
        tokens_cache_read = numberOrZero(usage.cache_read_input_tokens);
        tokens_cache_create = numberOrZero(usage.cache_creation_input_tokens);
      }
    }

    let isCorrection: 0 | 1 = 0;
    if (
      role === "user" &&
      lastAssistantTs !== null &&
      ts - lastAssistantTs < 5 * 60 * 1000 &&
      CORRECTION_MARKERS.test(text.trimStart())
    ) {
      isCorrection = 1;
    }

    turns.push({
      id: r.uuid,
      session_id: sessionId,
      seq,
      role,
      model,
      ts,
      tokens_in,
      tokens_out,
      tokens_cache_read,
      tokens_cache_create,
      text_len: text.length,
      latency_ms: prevTs === null ? null : ts - prevTs,
      is_correction: isCorrection,
    });

    if (role === "assistant") {
      const calls = extractToolCalls(msg?.content, r.uuid, sessionId, ts);
      toolCalls.push(...calls);
      lastAssistantTs = ts;
    }

    prevTs = ts;
    seq++;
  }

  return { turns, toolCalls };
}
