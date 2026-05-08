import { streamJsonl } from "../jsonl";
import { truncateGraphemes } from "../extract";

export interface CodexMetadata {
  cwd: string;
  auto_title: string | null;
  created_at: number;
  last_active_at: number;
  message_count: number;
}

const TITLE_MAX = 80;

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

// The first user message that the Codex VS Code extension sends wraps the
// real prompt in an "## My request for Codex:" heading after a context
// block. When present, we prefer the heading body — otherwise we'd render
// every session title as "# Context from my IDE setup".
function extractCodexUserPrompt(raw: string): string {
  const stripped = raw.replace(CODEX_NOISE_RE, "").trim();
  const heading = "## My request for Codex:";
  const idx = stripped.indexOf(heading);
  if (idx >= 0) {
    return stripped.slice(idx + heading.length).trim();
  }
  return stripped;
}

function userTextFromContent(content: unknown): string | null {
  if (!Array.isArray(content)) return null;
  for (const part of content) {
    if (!part || typeof part !== "object") continue;
    const p = part as Record<string, unknown>;
    if (p.type === "input_text" && typeof p.text === "string") {
      return p.text;
    }
  }
  return null;
}

export async function extractCodexMetadata(
  filePath: string,
): Promise<CodexMetadata> {
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

    if (r.type === "session_meta") {
      const payload = r.payload as Record<string, unknown> | undefined;
      if (payload && typeof payload.cwd === "string" && cwd === null) {
        cwd = payload.cwd;
      }
      continue;
    }

    if (r.type !== "response_item") continue;
    const payload = r.payload as Record<string, unknown> | undefined;
    if (!payload || payload.type !== "message") continue;

    if (payload.role === "user" || payload.role === "assistant") {
      messageCount++;
      if (autoTitle === null && payload.role === "user") {
        const text = userTextFromContent(payload.content);
        if (text) {
          const cleaned = extractCodexUserPrompt(text);
          if (cleaned) {
            autoTitle = truncateGraphemes(cleaned, TITLE_MAX);
          }
        }
      }
    }
  }

  if (cwd === null) {
    throw new Error(`extractCodexMetadata: no session_meta cwd in ${filePath}`);
  }

  return {
    cwd,
    auto_title: autoTitle,
    created_at: createdAt ?? 0,
    last_active_at: lastActiveAt ?? 0,
    message_count: messageCount,
  };
}

export const __test__ = { extractCodexUserPrompt, CODEX_NOISE_RE };
