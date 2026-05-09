import * as crypto from "node:crypto";
import type { IdeaRepository, IdeaRow } from "../db/ideas";
import type { ChunkRepository } from "../db/chunks";
import type { Embedder } from "../embed/types";
import { cosineSim } from "../embed/cosine";
import { detectIdeas, type DetectedIdea } from "./ideaDetector";

const CLUSTER_THRESHOLD = 0.78;

export class IdeaIndexer {
  constructor(
    private readonly ideas: IdeaRepository,
    private readonly chunks: ChunkRepository,
    private readonly embedder: Embedder,
    private readonly sinceDays = 30,
  ) {}

  async run(): Promise<void> {
    const sinceMs = Date.now() - this.sinceDays * 86400 * 1000;
    // Collect candidate user_msg chunks newer than sinceMs.
    const allChunks = this.chunks.listAll().filter(
      (c) => c.source_kind === "user_msg" && c.created_at >= sinceMs,
    );
    if (allChunks.length === 0) return;

    // Detect ideas per chunk.
    type Candidate = {
      sessionId: string;
      turnId: string;
      detectedAt: number;
      idea: DetectedIdea;
    };
    const candidates: Candidate[] = [];
    for (const c of allChunks) {
      for (const idea of detectIdeas(c.text)) {
        candidates.push({
          sessionId: c.session_id,
          turnId: c.source_id,
          detectedAt: c.created_at,
          idea,
        });
      }
    }
    if (candidates.length === 0) return;

    // Embed each idea text (batch).
    const vectors = await this.embedder.embed(candidates.map((c) => c.idea.text));

    // Greedy clustering: each candidate gets the cluster id of the first
    // earlier candidate whose vector is within threshold; otherwise a new
    // cluster id (stable hash of the canonical text).
    const clusterIds: string[] = [];
    const clusterReps: { idx: number; vec: Float32Array; id: string }[] = [];
    for (let i = 0; i < candidates.length; i++) {
      const v = vectors[i];
      let assigned: string | null = null;
      let bestSim = 0;
      for (const rep of clusterReps) {
        const sim = cosineSim(v, rep.vec);
        if (sim >= CLUSTER_THRESHOLD && sim > bestSim) {
          assigned = rep.id;
          bestSim = sim;
        }
      }
      if (!assigned) {
        const id =
          "cl_" +
          crypto
            .createHash("sha1")
            .update(candidates[i].idea.text.toLowerCase())
            .digest("hex")
            .slice(0, 12);
        assigned = id;
        clusterReps.push({ idx: i, vec: v, id });
      }
      clusterIds.push(assigned);
    }

    // Persist as IdeaRow[]. id = stable hash per (session, turn, text).
    const rows: IdeaRow[] = candidates.map((c, i) => {
      const id =
        "id_" +
        crypto
          .createHash("sha1")
          .update(`${c.sessionId}|${c.turnId}|${c.idea.text.toLowerCase()}`)
          .digest("hex")
          .slice(0, 16);
      return {
        id,
        cluster_id: clusterIds[i],
        text: c.idea.text,
        source_session_id: c.sessionId,
        source_turn_id: c.turnId,
        detected_at: c.detectedAt,
        confidence: c.idea.confidence,
        status: "open" as const,
      };
    });
    this.ideas.upsertMany(rows);
  }
}
