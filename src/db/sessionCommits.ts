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

  sessionsForCommits(shas: string[]): Map<string, SessionCommitRow[]> {
    const map = new Map<string, SessionCommitRow[]>();
    if (shas.length === 0) return map;
    const placeholders = shas.map(() => "?").join(",");
    const rows = this.db
      .prepare(
        `SELECT ${COLS} FROM session_commits WHERE commit_sha IN (${placeholders}) ORDER BY confidence DESC`,
      )
      .all(...shas) as SessionCommitRow[];
    for (const r of rows) {
      let bucket = map.get(r.commit_sha);
      if (!bucket) {
        bucket = [];
        map.set(r.commit_sha, bucket);
      }
      bucket.push(r);
    }
    return map;
  }

  commitsForSessions(sessionIds: string[]): Map<string, SessionCommitRow[]> {
    const map = new Map<string, SessionCommitRow[]>();
    if (sessionIds.length === 0) return map;
    const placeholders = sessionIds.map(() => "?").join(",");
    const rows = this.db
      .prepare(
        `SELECT ${COLS} FROM session_commits WHERE session_id IN (${placeholders}) ORDER BY confidence DESC`,
      )
      .all(...sessionIds) as SessionCommitRow[];
    for (const r of rows) {
      let bucket = map.get(r.session_id);
      if (!bucket) { bucket = []; map.set(r.session_id, bucket); }
      bucket.push(r);
    }
    return map;
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
