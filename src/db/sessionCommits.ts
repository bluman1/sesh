import type { Db } from "./connection";

export interface SessionCommitRow {
  session_id: string;
  commit_sha: string;
  confidence: number;
}

const COLS = "session_id, commit_sha, confidence";

export class SessionCommitRepository {
  constructor(private db: Db) {}

  upsertMany(rows: SessionCommitRow[]): void {
    if (rows.length === 0) return;
    const stmt = this.db.prepare(
      `INSERT INTO session_commits (${COLS}) VALUES (
         @session_id, @commit_sha, @confidence
       )
       ON CONFLICT(session_id, commit_sha) DO UPDATE SET
         confidence = excluded.confidence`,
    );
    const tx = this.db.transaction((batch: SessionCommitRow[]) => {
      for (const r of batch) stmt.run(r);
    });
    tx(rows);
  }

  commitsForSession(sessionId: string): SessionCommitRow[] {
    return this.db
      .prepare(
        `SELECT ${COLS} FROM session_commits WHERE session_id = ? ORDER BY confidence DESC`,
      )
      .all(sessionId) as SessionCommitRow[];
  }

  sessionsForCommit(sha: string): SessionCommitRow[] {
    return this.db
      .prepare(
        `SELECT ${COLS} FROM session_commits WHERE commit_sha = ? ORDER BY confidence DESC`,
      )
      .all(sha) as SessionCommitRow[];
  }

  deleteForSession(sessionId: string): void {
    this.db
      .prepare("DELETE FROM session_commits WHERE session_id = ?")
      .run(sessionId);
  }

  topConfidenceForSession(sessionId: string): number | null {
    const row = this.db
      .prepare(
        "SELECT MAX(confidence) AS c FROM session_commits WHERE session_id = ?",
      )
      .get(sessionId) as { c: number | null } | undefined;
    return row?.c ?? null;
  }
}
