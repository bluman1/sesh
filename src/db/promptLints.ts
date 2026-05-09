import type { Db } from "./connection";

export type LintStatus = "open" | "dismissed";

export interface PromptLintRow {
  id: string;
  session_id: string;
  turn_id: string;
  message: string;
  similar_session_ids: string[];
  detected_at: number;
  status: LintStatus;
}

const COLS = "id, session_id, turn_id, message, similar_session_ids, detected_at, status";

export class PromptLintRepository {
  constructor(private db: Db) {}

  upsertMany(rows: PromptLintRow[]): void {
    if (rows.length === 0) return;
    const stmt = this.db.prepare(
      `INSERT INTO prompt_lints (${COLS}) VALUES (
         @id, @session_id, @turn_id, @message, @similar_session_ids, @detected_at, @status
       )
       ON CONFLICT(id) DO UPDATE SET
         message = excluded.message,
         similar_session_ids = excluded.similar_session_ids`,
    );
    const tx = this.db.transaction((batch: PromptLintRow[]) => {
      for (const r of batch) {
        // similar_session_ids is JSON-encoded for storage.
        stmt.run({ ...r, similar_session_ids: JSON.stringify(r.similar_session_ids) });
      }
    });
    tx(rows);
  }

  listForSession(sessionId: string): PromptLintRow[] {
    const rows = this.db
      .prepare(`SELECT ${COLS} FROM prompt_lints WHERE session_id = ? AND status = 'open'`)
      .all(sessionId) as Array<
      Omit<PromptLintRow, "similar_session_ids"> & { similar_session_ids: string }
    >;
    return rows.map((r) => ({
      ...r,
      similar_session_ids: JSON.parse(r.similar_session_ids) as string[],
    }));
  }

  setStatus(id: string, status: LintStatus): void {
    this.db.prepare("UPDATE prompt_lints SET status = ? WHERE id = ?").run(status, id);
  }
}
