import type { Db } from "./connection";

export interface EmbeddingRow {
  chunk_id: string;
  model_name: string;
  dim: number;
  vector: Float32Array;
}

export function packVector(v: Float32Array): Buffer {
  return Buffer.from(v.buffer, v.byteOffset, v.byteLength);
}

export function unpackVector(buf: Buffer, dim: number): Float32Array {
  // Make a copy so the underlying SQLite buffer can be reused.
  const out = new Float32Array(dim);
  const view = new Float32Array(buf.buffer, buf.byteOffset, dim);
  out.set(view);
  return out;
}

export class EmbeddingRepository {
  constructor(private db: Db) {}

  upsertMany(rows: EmbeddingRow[]): void {
    if (rows.length === 0) return;
    const stmt = this.db.prepare(
      `INSERT INTO embeddings (chunk_id, model_name, dim, vector) VALUES (?, ?, ?, ?)
       ON CONFLICT(chunk_id, model_name) DO UPDATE SET
         dim = excluded.dim, vector = excluded.vector`,
    );
    const tx = this.db.transaction((batch: EmbeddingRow[]) => {
      for (const r of batch) {
        stmt.run(r.chunk_id, r.model_name, r.dim, packVector(r.vector));
      }
    });
    tx(rows);
  }

  listAll(modelName: string): { chunk_id: string; vector: Float32Array }[] {
    const rows = this.db
      .prepare(`SELECT chunk_id, dim, vector FROM embeddings WHERE model_name = ?`)
      .all(modelName) as { chunk_id: string; dim: number; vector: Buffer }[];
    return rows.map((r) => ({ chunk_id: r.chunk_id, vector: unpackVector(r.vector, r.dim) }));
  }

  listChunkIdsMissing(modelName: string, sessionId?: string): string[] {
    const sql = sessionId
      ? `SELECT c.id FROM chunks c
         WHERE c.session_id = ?
           AND NOT EXISTS (SELECT 1 FROM embeddings e WHERE e.chunk_id = c.id AND e.model_name = ?)`
      : `SELECT c.id FROM chunks c
         WHERE NOT EXISTS (SELECT 1 FROM embeddings e WHERE e.chunk_id = c.id AND e.model_name = ?)`;
    const rows = sessionId
      ? (this.db.prepare(sql).all(sessionId, modelName) as { id: string }[])
      : (this.db.prepare(sql).all(modelName) as { id: string }[]);
    return rows.map((r) => r.id);
  }

  deleteForChunk(chunkId: string): void {
    this.db.prepare("DELETE FROM embeddings WHERE chunk_id = ?").run(chunkId);
  }
}
