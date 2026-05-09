import type { Db } from "./connection";

export type ChunkKind = "turn" | "user_msg" | "tool_result" | "session_summary";

export interface ChunkRow {
  id: string;
  source_kind: ChunkKind;
  source_id: string;
  session_id: string;
  position: number;
  text: string;
  char_count: number;
  created_at: number;
}

const COLS =
  "id, source_kind, source_id, session_id, position, text, char_count, created_at";

export class ChunkRepository {
  constructor(private db: Db) {}

  upsertMany(rows: ChunkRow[]): void {
    if (rows.length === 0) return;
    const stmt = this.db.prepare(
      `INSERT INTO chunks (${COLS}) VALUES (
         @id, @source_kind, @source_id, @session_id, @position, @text, @char_count, @created_at
       )
       ON CONFLICT(id) DO UPDATE SET
         text = excluded.text,
         char_count = excluded.char_count`,
    );
    const tx = this.db.transaction((batch: ChunkRow[]) => {
      for (const r of batch) stmt.run(r);
    });
    tx(rows);
  }

  listForSession(sessionId: string): ChunkRow[] {
    return this.db
      .prepare(`SELECT ${COLS} FROM chunks WHERE session_id = ? ORDER BY position`)
      .all(sessionId) as ChunkRow[];
  }

  listAll(): ChunkRow[] {
    return this.db
      .prepare(`SELECT ${COLS} FROM chunks ORDER BY session_id, position`)
      .all() as ChunkRow[];
  }

  findByIds(ids: string[]): Map<string, ChunkRow> {
    const map = new Map<string, ChunkRow>();
    if (ids.length === 0) return map;
    const placeholders = ids.map(() => "?").join(",");
    const rows = this.db
      .prepare(`SELECT ${COLS} FROM chunks WHERE id IN (${placeholders})`)
      .all(...ids) as ChunkRow[];
    for (const r of rows) map.set(r.id, r);
    return map;
  }

  deleteForSession(sessionId: string): void {
    this.db.prepare("DELETE FROM chunks WHERE session_id = ?").run(sessionId);
  }
}
