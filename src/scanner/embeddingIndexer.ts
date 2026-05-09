import * as fs from "node:fs";
import * as readline from "node:readline";
import type { Db } from "../db/connection";
import type { SessionRepository } from "../db/sessions";
import type { ChunkRepository } from "../db/chunks";
import type { EmbeddingRepository, EmbeddingRow } from "../db/embeddings";
import type { TurnRepository, TurnRow } from "../db/turns";
import type { Embedder } from "../embed/types";
import { extractChunksFromTurns, type TurnWithText } from "./chunkExtractor";

const BATCH_SIZE = 32;

/**
 * Walks sessions that need embedding indexing (chunks missing OR embeddings
 * missing for the active model), extracts chunks from JSONL, embeds in
 * batches, persists. Lifecycle mirrors TurnsIndexer.
 */
export class EmbeddingIndexer {
  private cancelled = false;
  private running: Promise<void> | null = null;
  private onProgress?: (indexed: number, total: number) => void;

  constructor(
    private readonly db: Db,
    private readonly sessions: SessionRepository,
    private readonly turns: TurnRepository,
    private readonly chunks: ChunkRepository,
    private readonly embeddings: EmbeddingRepository,
    private readonly embedder: Embedder,
  ) {}

  setProgressHandler(h: (indexed: number, total: number) => void): void {
    this.onProgress = h;
  }

  cancel(): void {
    this.cancelled = true;
  }

  run(): Promise<void> {
    if (this.running) return this.running;
    this.cancelled = false;
    this.running = this.doRun().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async doRun(): Promise<void> {
    const sessionList = this.sessions.listForEmbeddingIndexing();
    const total = sessionList.length;
    if (total === 0) {
      this.onProgress?.(0, 0);
      return;
    }
    let done = 0;
    this.onProgress?.(0, total);
    for (const s of sessionList) {
      if (this.cancelled) return;
      try {
        await this.indexSession(s.id, s.file_path);
      } catch {
        // continue on per-session failures
      }
      done++;
      this.onProgress?.(done, total);
    }
  }

  async indexSession(sessionId: string, filePath: string): Promise<void> {
    // Skip if file doesn't exist on disk anymore.
    if (!fs.existsSync(filePath)) return;

    // 1) Load existing chunks for the session — if zero, parse JSONL and
    //    rebuild. If non-zero but embeddings missing for current model,
    //    skip the parse and just embed the missing ones.
    const existingChunks = this.chunks.listForSession(sessionId);
    if (existingChunks.length === 0) {
      const turnsForSession = this.turns.listBySession(sessionId);
      if (turnsForSession.length === 0) return;
      const turnsWithText = await readTurnTexts(filePath, turnsForSession);
      const newChunks = extractChunksFromTurns(turnsWithText, Date.now());
      if (newChunks.length === 0) return;
      const insertChunks = this.db.transaction(() => {
        this.chunks.upsertMany(newChunks);
      });
      insertChunks();
    }

    const missingIds = this.embeddings.listChunkIdsMissing(
      this.embedder.modelName,
      sessionId,
    );
    if (missingIds.length === 0) return;
    const missing = this.chunks.findByIds(missingIds);
    const targets = [...missing.values()];

    for (let i = 0; i < targets.length; i += BATCH_SIZE) {
      if (this.cancelled) return;
      const batch = targets.slice(i, i + BATCH_SIZE);
      const vectors = await this.embedder.embed(batch.map((c) => c.text));
      const rows: EmbeddingRow[] = batch.map((c, j) => ({
        chunk_id: c.id,
        model_name: this.embedder.modelName,
        dim: this.embedder.dim,
        vector: vectors[j],
      }));
      this.embeddings.upsertMany(rows);
    }
  }
}

/**
 * Read the JSONL file and return per-turn text. Each turn row's id equals
 * the message's own uuid (as set by extractTurns — both user and assistant
 * messages use their own uuid as the turn id). We extract text blocks from
 * both user and assistant messages.
 */
async function readTurnTexts(
  filePath: string,
  turns: TurnRow[],
): Promise<TurnWithText[]> {
  // Build an index of turn.id → TurnRow for quick lookup.
  const turnsById = new Map<string, TurnRow>();
  for (const t of turns) turnsById.set(t.id, t);

  const stream = fs.createReadStream(filePath, { encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  const textByTurnId = new Map<string, string>();

  for await (const line of rl) {
    if (!line) continue;
    let evt: unknown;
    try {
      evt = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof evt !== "object" || evt === null) continue;
    const e = evt as Record<string, unknown>;
    const type = e.type as string | undefined;
    const uuid = e.uuid as string | undefined;
    if (!uuid || (type !== "user" && type !== "assistant")) continue;

    // Only process if this uuid corresponds to a known turn.
    if (!turnsById.has(uuid)) continue;

    const message = e.message as Record<string, unknown> | undefined;
    if (!message) continue;

    const content = message.content;
    let text = "";

    if (typeof content === "string") {
      text = content;
    } else if (Array.isArray(content)) {
      const parts: string[] = [];
      for (const c of content) {
        if (typeof c === "object" && c && "type" in c) {
          const cc = c as { type: string; text?: string };
          if (cc.type === "text" && typeof cc.text === "string") {
            parts.push(cc.text);
          }
        }
      }
      text = parts.join("\n");
    }

    if (text) {
      textByTurnId.set(uuid, text);
    }
  }

  const out: TurnWithText[] = [];
  for (const t of turns) {
    const text = textByTurnId.get(t.id) ?? "";
    if (text) out.push({ turn: t, text });
  }
  return out;
}
