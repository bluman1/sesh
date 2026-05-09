import type { Db } from "./connection";

export type SuggestionStatus = "open" | "accepted" | "dismissed";

export interface ClaudeMdSuggestionRow {
  id: string;
  cluster_id: string;
  body: string;
  source_count: number;
  detected_at: number;
  status: SuggestionStatus;
}

const COLS = "id, cluster_id, body, source_count, detected_at, status";

export class ClaudeMdSuggestionRepository {
  constructor(private db: Db) {}

  upsertMany(rows: ClaudeMdSuggestionRow[]): void {
    if (rows.length === 0) return;
    const stmt = this.db.prepare(
      `INSERT INTO claude_md_suggestions (${COLS}) VALUES (
         @id, @cluster_id, @body, @source_count, @detected_at, @status
       )
       ON CONFLICT(id) DO UPDATE SET
         body = excluded.body,
         source_count = excluded.source_count`,
    );
    const tx = this.db.transaction((batch: ClaudeMdSuggestionRow[]) => {
      for (const r of batch) stmt.run(r);
    });
    tx(rows);
  }

  listOpen(): ClaudeMdSuggestionRow[] {
    return this.db
      .prepare(
        `SELECT ${COLS} FROM claude_md_suggestions WHERE status = 'open' ORDER BY source_count DESC, detected_at DESC`,
      )
      .all() as ClaudeMdSuggestionRow[];
  }

  setStatus(id: string, status: SuggestionStatus): void {
    this.db
      .prepare("UPDATE claude_md_suggestions SET status = ? WHERE id = ?")
      .run(status, id);
  }
}
