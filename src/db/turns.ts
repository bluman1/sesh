import type { Db } from "./connection";

export interface TurnRow {
  id: string;
  session_id: string;
  seq: number;
  role: "user" | "assistant";
  model: string | null;
  ts: number;
  tokens_in: number;
  tokens_out: number;
  tokens_cache_read: number;
  tokens_cache_create: number;
  text_len: number;
  latency_ms: number | null;
  is_correction: 0 | 1;
}

const TURN_COLUMNS =
  "id, session_id, seq, role, model, ts, tokens_in, tokens_out, tokens_cache_read, tokens_cache_create, text_len, latency_ms, is_correction";

export class TurnRepository {
  constructor(private db: Db) {}

  upsertMany(rows: TurnRow[]): void {
    if (rows.length === 0) return;
    const stmt = this.db.prepare(
      `INSERT INTO turns (${TURN_COLUMNS}) VALUES (
         @id, @session_id, @seq, @role, @model, @ts, @tokens_in, @tokens_out,
         @tokens_cache_read, @tokens_cache_create, @text_len, @latency_ms, @is_correction
       )
       ON CONFLICT(id) DO UPDATE SET
         seq = excluded.seq,
         model = excluded.model,
         ts = excluded.ts,
         tokens_in = excluded.tokens_in,
         tokens_out = excluded.tokens_out,
         tokens_cache_read = excluded.tokens_cache_read,
         tokens_cache_create = excluded.tokens_cache_create,
         text_len = excluded.text_len,
         latency_ms = excluded.latency_ms,
         is_correction = excluded.is_correction`,
    );
    const tx = this.db.transaction((batch: TurnRow[]) => {
      for (const r of batch) stmt.run(r);
    });
    tx(rows);
  }

  listBySession(sessionId: string): TurnRow[] {
    return this.db
      .prepare(
        `SELECT ${TURN_COLUMNS} FROM turns WHERE session_id = ? ORDER BY seq ASC`,
      )
      .all(sessionId) as TurnRow[];
  }

  listByModel(model: string): TurnRow[] {
    return this.db
      .prepare(
        `SELECT ${TURN_COLUMNS} FROM turns WHERE model = ? ORDER BY ts DESC`,
      )
      .all(model) as TurnRow[];
  }

  deleteBySession(sessionId: string): void {
    this.db.prepare("DELETE FROM turns WHERE session_id = ?").run(sessionId);
  }

  countBySession(sessionId: string): number {
    return (
      this.db
        .prepare("SELECT COUNT(*) as c FROM turns WHERE session_id = ?")
        .get(sessionId) as { c: number }
    ).c;
  }
}
