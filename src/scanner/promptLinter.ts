import * as crypto from "node:crypto";
import type { Db } from "../db/connection";
import type { ChunkRepository } from "../db/chunks";
import { EmbeddingRepository } from "../db/embeddings";
import type { Embedder } from "../embed/types";
import { rankByCosine } from "../embed/cosine";
import type { PromptLintRepository, PromptLintRow } from "../db/promptLints";

const SIM_THRESHOLD = 0.7;
const MIN_SIMILAR_SESSIONS = 2;
const MAX_SIMILAR = 5;

/**
 * For each session's first user message: find similar past first-messages
 * (across other sessions) where the assistant got at least one is_correction
 * follow-up. If at least MIN_SIMILAR_SESSIONS qualify, persist a lint.
 */
export class PromptLinter {
  constructor(
    private readonly db: Db,
    // chunks kept for interface consistency and future incremental indexing
    chunks: ChunkRepository,
    private readonly embeddings: EmbeddingRepository,
    private readonly lints: PromptLintRepository,
    private readonly embedder: Embedder,
  ) {
    void chunks;
  }

  async run(): Promise<void> {
    // First-user-msg chunk per session: position 0 of source_kind = 'user_msg' from the earliest user turn.
    const candidates = this.db
      .prepare(
        `SELECT c.id AS chunk_id, c.session_id AS session_id, c.source_id AS turn_id, c.text AS text
         FROM chunks c
         JOIN (
           SELECT session_id, MIN(t.ts) AS first_ts
           FROM turns t
           WHERE t.role = 'user'
           GROUP BY session_id
         ) firsts ON firsts.session_id = c.session_id
         JOIN turns t2 ON t2.id = c.source_id AND t2.ts = firsts.first_ts AND t2.role = 'user'
         WHERE c.source_kind = 'user_msg' AND c.position = 0`,
      )
      .all() as { chunk_id: string; session_id: string; turn_id: string; text: string }[];

    if (candidates.length === 0) return;

    // Sessions whose user later issued a correction.
    const correctedSessions = new Set(
      (this.db
        .prepare(`SELECT DISTINCT session_id FROM turns WHERE is_correction = 1`)
        .all() as { session_id: string }[])
        .map((r) => r.session_id),
    );

    const allEmbeddings = this.embeddings.listAll(this.embedder.modelName);
    if (allEmbeddings.length === 0) return;
    const embByChunkId = new Map(allEmbeddings.map((e) => [e.chunk_id, e.vector]));

    const persist: PromptLintRow[] = [];
    const now = Date.now();
    for (const c of candidates) {
      const seedVec = embByChunkId.get(c.chunk_id);
      if (!seedVec) continue;
      const others = candidates.filter((o) => o.session_id !== c.session_id);
      const otherVecs = others.map((o) => embByChunkId.get(o.chunk_id));
      const validOthers = others.filter((_, i) => otherVecs[i] !== undefined);
      const validVecs = otherVecs.filter((v): v is Float32Array => v !== undefined);
      if (validOthers.length === 0) continue;
      const ranked = rankByCosine(seedVec, validVecs).filter((r) => r.score >= SIM_THRESHOLD);
      const similarSessionIds = ranked
        .map((r) => validOthers[r.idx].session_id)
        .filter((sid) => correctedSessions.has(sid))
        .slice(0, MAX_SIMILAR);
      if (similarSessionIds.length < MIN_SIMILAR_SESSIONS) continue;
      const id = "lint_" + crypto.createHash("sha1").update(`${c.session_id}|${c.turn_id}`).digest("hex").slice(0, 12);
      persist.push({
        id,
        session_id: c.session_id,
        turn_id: c.turn_id,
        message: `Prompts like this got corrected in ${similarSessionIds.length} similar sessions. Consider being more specific.`,
        similar_session_ids: similarSessionIds,
        detected_at: now,
        status: "open",
      });
    }
    this.lints.upsertMany(persist);
  }
}
