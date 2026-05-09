import type { Db } from "./connection";

export type IdeaStatus = "open" | "dismissed" | "done" | "scheduled";

export interface IdeaRow {
  id: string;
  cluster_id: string;
  text: string;
  source_session_id: string;
  source_turn_id: string | null;
  detected_at: number;
  confidence: number;
  status: IdeaStatus;
}

const COLS =
  "id, cluster_id, text, source_session_id, source_turn_id, detected_at, confidence, status";

export class IdeaRepository {
  constructor(private db: Db) {}

  upsertMany(rows: IdeaRow[]): void {
    if (rows.length === 0) return;
    const stmt = this.db.prepare(
      `INSERT INTO ideas (${COLS}) VALUES (
         @id, @cluster_id, @text, @source_session_id, @source_turn_id, @detected_at, @confidence, @status
       )
       ON CONFLICT(id) DO UPDATE SET
         cluster_id = excluded.cluster_id,
         text = excluded.text,
         confidence = excluded.confidence`,
    );
    const tx = this.db.transaction((batch: IdeaRow[]) => {
      for (const r of batch) stmt.run(r);
    });
    tx(rows);
  }

  listAll(): IdeaRow[] {
    return this.db
      .prepare(`SELECT ${COLS} FROM ideas ORDER BY detected_at DESC`)
      .all() as IdeaRow[];
  }

  listActive(): IdeaRow[] {
    return this.db
      .prepare(`SELECT ${COLS} FROM ideas WHERE status = 'open' ORDER BY detected_at DESC`)
      .all() as IdeaRow[];
  }

  setStatus(id: string, status: IdeaStatus): void {
    this.db.prepare("UPDATE ideas SET status = ? WHERE id = ?").run(status, id);
  }

  listClusters(): { cluster_id: string; ideas: IdeaRow[]; size: number }[] {
    const rows = this.listActive();
    const map = new Map<string, IdeaRow[]>();
    for (const r of rows) {
      let bucket = map.get(r.cluster_id);
      if (!bucket) {
        bucket = [];
        map.set(r.cluster_id, bucket);
      }
      bucket.push(r);
    }
    return [...map.entries()]
      .map(([cluster_id, ideas]) => ({ cluster_id, ideas, size: ideas.length }))
      .sort((a, b) => b.size - a.size);
  }
}
