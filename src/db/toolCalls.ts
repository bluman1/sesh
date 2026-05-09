import type { Db } from "./connection";

export interface ToolCallRow {
  id: string;
  turn_id: string;
  session_id: string;
  name: string;
  target_path: string | null;
  is_error: 0 | 1;
  result_size: number;
  ts: number;
}

const TC_COLUMNS = "id, turn_id, session_id, name, target_path, is_error, result_size, ts";

export class ToolCallRepository {
  constructor(private db: Db) {}

  upsertMany(rows: ToolCallRow[]): void {
    if (rows.length === 0) return;
    const stmt = this.db.prepare(
      `INSERT INTO tool_calls (${TC_COLUMNS}) VALUES (
         @id, @turn_id, @session_id, @name, @target_path, @is_error, @result_size, @ts
       )
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         target_path = excluded.target_path,
         is_error = excluded.is_error,
         result_size = excluded.result_size,
         ts = excluded.ts`,
    );
    const tx = this.db.transaction((batch: ToolCallRow[]) => {
      for (const r of batch) stmt.run(r);
    });
    tx(rows);
  }

  listBySession(sessionId: string): ToolCallRow[] {
    return this.db
      .prepare(
        `SELECT ${TC_COLUMNS} FROM tool_calls WHERE session_id = ? ORDER BY ts ASC`,
      )
      .all(sessionId) as ToolCallRow[];
  }

  listByPath(path: string): ToolCallRow[] {
    return this.db
      .prepare(`SELECT ${TC_COLUMNS} FROM tool_calls WHERE target_path = ?`)
      .all(path) as ToolCallRow[];
  }

  listByName(name: string): ToolCallRow[] {
    return this.db
      .prepare(`SELECT ${TC_COLUMNS} FROM tool_calls WHERE name = ?`)
      .all(name) as ToolCallRow[];
  }

  topToolsForSessions(sessionIds: string[]): { name: string; count: number }[] {
    if (sessionIds.length === 0) return [];
    const placeholders = sessionIds.map(() => "?").join(",");
    return this.db
      .prepare(
        `SELECT name, COUNT(*) as count FROM tool_calls
         WHERE session_id IN (${placeholders})
         GROUP BY name ORDER BY count DESC`,
      )
      .all(...sessionIds) as { name: string; count: number }[];
  }

  deleteBySession(sessionId: string): void {
    this.db.prepare("DELETE FROM tool_calls WHERE session_id = ?").run(sessionId);
  }
}
