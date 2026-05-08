import { streamJsonl } from "./jsonl";
import { streamCodexSessionText } from "./codex/sessionText";
import type { Db } from "../db/connection";
import type { SessionRepository } from "../db/sessions";

const SYSTEM_TAG_RE = /<(system-reminder|command-name|command-message|command-args|env|local-command-stdout|local-command-stderr|ide_selection|ide_diagnostics)>[\s\S]*?<\/\1>/g;
const FTS_PER_SESSION_MAX_BYTES = 512 * 1024; // 512 KB cap per session

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

async function* streamClaudeSessionText(
  filePath: string,
): AsyncIterable<string> {
  for await (const rec of streamJsonl(filePath)) {
    const r = rec as Record<string, unknown>;
    if (r.type !== "user" && r.type !== "assistant") continue;
    const msg = r.message as { content?: unknown } | undefined;
    const raw = asText(msg?.content);
    if (raw === null) continue;
    const cleaned = raw.replace(SYSTEM_TAG_RE, "").trim();
    if (cleaned) yield cleaned;
  }
}

export class ContentIndexer {
  private cancelled = false;
  private running: Promise<void> | null = null;
  private onProgress?: (indexed: number, total: number) => void;

  constructor(
    private readonly db: Db,
    private readonly sessions: SessionRepository,
  ) {}

  setProgressHandler(handler: (indexed: number, total: number) => void): void {
    this.onProgress = handler;
  }

  async run(): Promise<void> {
    if (this.running) return this.running;
    this.cancelled = false;
    this.running = this.doRun().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  cancel(): void {
    this.cancelled = true;
  }

  private async doRun(): Promise<void> {
    const queue = this.sessions.listForIndexing();
    const total = queue.length;
    if (total === 0) {
      this.onProgress?.(0, 0);
      return;
    }
    let done = 0;
    this.onProgress?.(0, total);
    for (const job of queue) {
      if (this.cancelled) return;
      try {
        await this.indexOne(job.id, job.file_path, job.source);
      } catch {
        // ignore single-file failures; indexer continues
      }
      done++;
      this.onProgress?.(done, total);
    }
  }

  async indexOne(id: string, filePath: string, source = "claude-code"): Promise<void> {
    const parts: string[] = [];
    let bytes = 0;
    const stream =
      source === "codex"
        ? streamCodexSessionText(filePath)
        : streamClaudeSessionText(filePath);
    for await (const cleaned of stream) {
      const len = Buffer.byteLength(cleaned, "utf8");
      if (bytes + len > FTS_PER_SESSION_MAX_BYTES) break;
      bytes += len;
      parts.push(cleaned);
    }
    const content = parts.join("\n\n");
    const tx = this.db.transaction(() => {
      this.db.prepare("DELETE FROM session_content_fts WHERE session_id = ?").run(id);
      if (content) {
        this.db
          .prepare(
            "INSERT INTO session_content_fts (session_id, content) VALUES (?, ?)",
          )
          .run(id, content);
      }
      this.sessions.setIndexProgress(id, 0, true);
    });
    tx();
  }
}
