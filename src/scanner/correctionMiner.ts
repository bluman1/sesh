import * as crypto from "node:crypto";
import type { Db } from "../db/connection";
import type { ChunkRepository } from "../db/chunks";
import { ClaudeMdSuggestionRepository, type ClaudeMdSuggestionRow } from "../db/claudeMd";
import type { Embedder } from "../embed/types";
import { cosineSim } from "../embed/cosine";

const CLUSTER_THRESHOLD = 0.75;
const MIN_CLUSTER_SIZE = 3;

export class CorrectionMiner {
  constructor(
    private readonly db: Db,
    // chunks kept for interface consistency and future incremental indexing
    chunks: ChunkRepository,
    private readonly suggestions: ClaudeMdSuggestionRepository,
    private readonly embedder: Embedder,
  ) {
    void chunks;
  }

  async run(): Promise<void> {
    // 1) Pull user_msg chunks for turns flagged is_correction=1.
    const rows = this.db
      .prepare(
        `SELECT c.id AS chunk_id, c.text AS text
         FROM chunks c
         JOIN turns t ON t.id = c.source_id
         WHERE c.source_kind = 'user_msg' AND t.is_correction = 1
           AND length(c.text) >= 30
         ORDER BY c.created_at ASC`,
      )
      .all() as { chunk_id: string; text: string }[];

    if (rows.length === 0) return;

    const vectors = await this.embedder.embed(rows.map((r) => r.text));

    // Greedy cluster.
    const clusterIds: string[] = [];
    const reps: { vec: Float32Array; id: string; texts: string[] }[] = [];
    for (let i = 0; i < rows.length; i++) {
      let assigned: string | null = null;
      let bestSim = 0;
      let bestRep: typeof reps[number] | null = null;
      for (const rep of reps) {
        const sim = cosineSim(vectors[i], rep.vec);
        if (sim >= CLUSTER_THRESHOLD && sim > bestSim) {
          assigned = rep.id;
          bestSim = sim;
          bestRep = rep;
        }
      }
      if (!assigned) {
        const id = "cmcl_" + crypto.createHash("sha1").update(rows[i].text.toLowerCase()).digest("hex").slice(0, 12);
        const newRep = { vec: vectors[i], id, texts: [rows[i].text] };
        reps.push(newRep);
        assigned = id;
      } else if (bestRep) {
        bestRep.texts.push(rows[i].text);
      }
      clusterIds.push(assigned);
    }

    // For each cluster ≥ MIN_CLUSTER_SIZE, build a suggestion body.
    const persistRows: ClaudeMdSuggestionRow[] = [];
    for (const rep of reps) {
      if (rep.texts.length < MIN_CLUSTER_SIZE) continue;
      const id = "cms_" + crypto.createHash("sha1").update(rep.id).digest("hex").slice(0, 12);
      const head = rep.texts[0];
      const body = `You've corrected the assistant on this kind of thing ${rep.texts.length} times. Consider adding a CLAUDE.md note to head it off:\n\n> ${head.slice(0, 200)}${head.length > 200 ? "…" : ""}`;
      persistRows.push({
        id,
        cluster_id: rep.id,
        body,
        source_count: rep.texts.length,
        detected_at: Date.now(),
        status: "open",
      });
    }
    this.suggestions.upsertMany(persistRows);
  }
}
