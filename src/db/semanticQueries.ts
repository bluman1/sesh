import type { Db } from "./connection";
import type { ChunkRow } from "./chunks";
import { ChunkRepository } from "./chunks";
import { EmbeddingRepository } from "./embeddings";
import type { Embedder } from "../embed/types";
import { rankByCosine } from "../embed/cosine";

export interface SearchHit {
  chunk: ChunkRow;
  session_id: string;
  session_title: string;
  session_project_path: string;
  score: number;
}

export async function semanticSearch(
  db: Db,
  embedder: Embedder,
  query: string,
  opts?: { limit?: number },
): Promise<SearchHit[]> {
  const limit = opts?.limit ?? 30;
  const trimmed = query.trim();
  if (!trimmed) return [];

  const [queryVec] = await embedder.embed([trimmed]);
  const allEmbeddings = new EmbeddingRepository(db).listAll(embedder.modelName);
  if (allEmbeddings.length === 0) return [];

  const ranked = rankByCosine(
    queryVec,
    allEmbeddings.map((e) => e.vector),
    Math.min(limit * 4, allEmbeddings.length), // overshoot, then dedupe by session
  );

  const hitChunkIds = ranked.map((r) => allEmbeddings[r.idx].chunk_id);
  const chunkMap = new ChunkRepository(db).findByIds(hitChunkIds);

  const sessionIds = [
    ...new Set([...chunkMap.values()].map((c) => c.session_id)),
  ];
  const sessionRows =
    sessionIds.length === 0
      ? []
      : (db
          .prepare(
            `SELECT id, project_path, COALESCE(custom_title, auto_title, '(untitled)') AS title
           FROM sessions WHERE id IN (${sessionIds.map(() => "?").join(",")})`,
          )
          .all(...sessionIds) as {
          id: string;
          project_path: string;
          title: string;
        }[]);
  const sessionById = new Map(sessionRows.map((s) => [s.id, s]));

  const out: SearchHit[] = [];
  for (const r of ranked) {
    if (out.length >= limit) break;
    const emb = allEmbeddings[r.idx];
    const chunk = chunkMap.get(emb.chunk_id);
    if (!chunk) continue;
    const session = sessionById.get(chunk.session_id);
    if (!session) continue;
    out.push({
      chunk,
      session_id: chunk.session_id,
      session_title: session.title,
      session_project_path: session.project_path,
      score: r.score,
    });
  }
  return out;
}

export async function findSimilarTurns(
  db: Db,
  chunkId: string,
  modelName: string,
  opts?: { limit?: number; excludeSession?: string },
): Promise<SearchHit[]> {
  const limit = opts?.limit ?? 10;
  // Look up the source vector for the seed chunk.
  const seedRow = db
    .prepare(
      `SELECT vector, dim FROM embeddings WHERE chunk_id = ? AND model_name = ?`,
    )
    .get(chunkId, modelName) as { vector: Buffer; dim: number } | undefined;
  if (!seedRow) return [];

  const seed = new Float32Array(seedRow.dim);
  seed.set(
    new Float32Array(seedRow.vector.buffer, seedRow.vector.byteOffset, seedRow.dim),
  );

  const all = new EmbeddingRepository(db)
    .listAll(modelName)
    .filter((e) => e.chunk_id !== chunkId);
  const ranked = rankByCosine(
    seed,
    all.map((e) => e.vector),
    Math.min(limit * 4, all.length),
  );

  const ids = ranked.map((r) => all[r.idx].chunk_id);
  const chunkMap = new ChunkRepository(db).findByIds(ids);

  const sessionIds = [
    ...new Set([...chunkMap.values()].map((c) => c.session_id)),
  ].filter((id) => id !== opts?.excludeSession);
  if (sessionIds.length === 0) return [];

  const sessionRows = db
    .prepare(
      `SELECT id, project_path, COALESCE(custom_title, auto_title, '(untitled)') AS title
       FROM sessions WHERE id IN (${sessionIds.map(() => "?").join(",")})`,
    )
    .all(...sessionIds) as {
    id: string;
    project_path: string;
    title: string;
  }[];
  const sessionById = new Map(sessionRows.map((s) => [s.id, s]));

  const out: SearchHit[] = [];
  for (const r of ranked) {
    if (out.length >= limit) break;
    const emb = all[r.idx];
    const chunk = chunkMap.get(emb.chunk_id);
    if (!chunk) continue;
    const session = sessionById.get(chunk.session_id);
    if (!session) continue;
    out.push({
      chunk,
      session_id: chunk.session_id,
      session_title: session.title,
      session_project_path: session.project_path,
      score: r.score,
    });
  }
  return out;
}
