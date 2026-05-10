import type { Db } from "./connection";
import { ChunkRepository } from "./chunks";
import { EmbeddingRepository } from "./embeddings";
import { cosineSim } from "../embed/cosine";

export interface Topic {
  id: string;
  label: string;
  representative: string;
  size: number;
  session_count: number;
  examples: { session_id: string; title: string }[];
}

const CLUSTER_THRESHOLD = 0.65;

export function computeTopics(db: Db, modelName: string, opts?: { limit?: number }): Topic[] {
  const limit = opts?.limit ?? 30;

  const allEmbs = new EmbeddingRepository(db).listAll(modelName);
  if (allEmbs.length === 0) return [];

  const chunkMap = new ChunkRepository(db).findByIds(allEmbs.map((e) => e.chunk_id));

  // Greedy clustering — assign each embedding to the first cluster within
  // CLUSTER_THRESHOLD; otherwise start a new one. Cluster reps are the
  // first member added.
  type Cluster = { rep: { chunk_id: string; vec: Float32Array; text: string; session_id: string }; members: { chunk_id: string; session_id: string }[] };
  const clusters: Cluster[] = [];
  for (const emb of allEmbs) {
    const chunk = chunkMap.get(emb.chunk_id);
    if (!chunk || !chunk.text || chunk.text.length < 40) continue;
    let assigned: Cluster | null = null;
    let bestSim = 0;
    for (const c of clusters) {
      const s = cosineSim(emb.vector, c.rep.vec);
      if (s >= CLUSTER_THRESHOLD && s > bestSim) {
        bestSim = s;
        assigned = c;
      }
    }
    if (!assigned) {
      clusters.push({
        rep: { chunk_id: emb.chunk_id, vec: emb.vector, text: chunk.text, session_id: chunk.session_id },
        members: [{ chunk_id: emb.chunk_id, session_id: chunk.session_id }],
      });
    } else {
      assigned.members.push({ chunk_id: emb.chunk_id, session_id: chunk.session_id });
    }
  }

  const topics: Topic[] = clusters
    .filter((c) => c.members.length >= 2)
    .map((c, i) => {
      const sessionIds = [...new Set(c.members.map((m) => m.session_id))];
      const rep = c.rep.text;
      // Label = first sentence-ish of the rep, or first 60 chars.
      const dotIdx = rep.search(/[.!?]\s/);
      const label = (dotIdx > 0 && dotIdx < 80 ? rep.slice(0, dotIdx) : rep.slice(0, 80)).trim();
      const exampleIds = sessionIds.slice(0, 5);
      const titleRows =
        exampleIds.length === 0
          ? []
          : (db
              .prepare(
                `SELECT id, COALESCE(custom_title, auto_title, '(untitled)') AS title
                   FROM sessions WHERE id IN (${exampleIds.map(() => "?").join(",")})`,
              )
              .all(...exampleIds) as { id: string; title: string }[]);
      const byId = new Map(titleRows.map((r) => [r.id, r.title]));
      const examples = exampleIds.map((sid) => ({
        session_id: sid,
        title: byId.get(sid) ?? "(untitled)",
      }));
      return {
        id: `topic_${i}_${c.rep.chunk_id.slice(-8)}`,
        label,
        representative: rep.length > 280 ? rep.slice(0, 280) + "…" : rep,
        size: c.members.length,
        session_count: sessionIds.length,
        examples,
      };
    })
    .sort((a, b) => b.size - a.size)
    .slice(0, limit);

  return topics;
}
