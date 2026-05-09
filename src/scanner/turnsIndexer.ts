import type { Db } from "../db/connection";
import type { SessionRepository } from "../db/sessions";
import type { TurnRepository } from "../db/turns";
import type { ToolCallRepository } from "../db/toolCalls";
import { extractTurns } from "./extractTurns";

export class TurnsIndexer {
  private cancelled = false;
  private running: Promise<void> | null = null;
  private onProgress?: (indexed: number, total: number) => void;

  constructor(
    private readonly db: Db,
    private readonly sessions: SessionRepository,
    private readonly turns: TurnRepository,
    private readonly toolCalls: ToolCallRepository,
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
    const queue = this.sessions.listForTurnsIndexing();
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
    if (source !== "claude-code") {
      // Codex source uses a different schema; substrate 1 ships claude-code only.
      // Mark indexed so we don't loop over it forever.
      this.sessions.setTurnsIndexProgress(id, 0, true);
      return;
    }
    const { turns, toolCalls } = await extractTurns(filePath, id);
    const tx = this.db.transaction(() => {
      // Replace approach: clear and re-insert. Resumable progress is tracked by
      // turns_last_offset for future incremental support; for v1 we re-extract
      // the whole file, which is fine because most sessions are <1MB.
      this.turns.deleteBySession(id);
      this.toolCalls.deleteBySession(id);
      if (turns.length > 0) this.turns.upsertMany(turns);
      if (toolCalls.length > 0) this.toolCalls.upsertMany(toolCalls);
      this.sessions.setTurnsIndexProgress(id, 0, true);
    });
    tx();
  }
}
