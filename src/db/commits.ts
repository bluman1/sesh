import type { Db } from "./connection";

export interface CommitRow {
  sha: string;
  repo_path: string;
  branch: string | null;
  authored_at: number;
  author: string | null;
  message: string | null;
}

export interface CommitFileRow {
  sha: string;
  path: string;
  status: string;
  additions: number;
  deletions: number;
}

const COMMIT_COLUMNS = "sha, repo_path, branch, authored_at, author, message";
const FILE_COLUMNS = "sha, path, status, additions, deletions";

export class CommitRepository {
  constructor(private db: Db) {}

  upsertCommit(row: CommitRow): void {
    this.db
      .prepare(
        `INSERT INTO commits (${COMMIT_COLUMNS}) VALUES (
           @sha, @repo_path, @branch, @authored_at, @author, @message
         )
         ON CONFLICT(sha) DO UPDATE SET
           repo_path = excluded.repo_path,
           branch = excluded.branch,
           authored_at = excluded.authored_at,
           author = excluded.author,
           message = excluded.message`,
      )
      .run(row);
  }

  upsertFiles(rows: CommitFileRow[]): void {
    if (rows.length === 0) return;
    const stmt = this.db.prepare(
      `INSERT INTO commit_files (${FILE_COLUMNS}) VALUES (
         @sha, @path, @status, @additions, @deletions
       )
       ON CONFLICT(sha, path) DO UPDATE SET
         status = excluded.status,
         additions = excluded.additions,
         deletions = excluded.deletions`,
    );
    const tx = this.db.transaction((batch: CommitFileRow[]) => {
      for (const r of batch) stmt.run(r);
    });
    tx(rows);
  }

  findBySha(sha: string): CommitRow | null {
    const row = this.db
      .prepare(`SELECT ${COMMIT_COLUMNS} FROM commits WHERE sha = ?`)
      .get(sha) as CommitRow | undefined;
    return row ?? null;
  }

  findByShas(shas: string[]): Map<string, CommitRow> {
    const map = new Map<string, CommitRow>();
    if (shas.length === 0) return map;
    const placeholders = shas.map(() => "?").join(",");
    const rows = this.db
      .prepare(`SELECT ${COMMIT_COLUMNS} FROM commits WHERE sha IN (${placeholders})`)
      .all(...shas) as CommitRow[];
    for (const r of rows) map.set(r.sha, r);
    return map;
  }

  listForRepo(repoPath: string): CommitRow[] {
    return this.db
      .prepare(
        `SELECT ${COMMIT_COLUMNS} FROM commits WHERE repo_path = ? ORDER BY authored_at DESC`,
      )
      .all(repoPath) as CommitRow[];
  }

  listForRepoSince(repoPath: string, since: number): CommitRow[] {
    return this.db
      .prepare(
        `SELECT ${COMMIT_COLUMNS} FROM commits WHERE repo_path = ? AND authored_at >= ? ORDER BY authored_at DESC`,
      )
      .all(repoPath, since) as CommitRow[];
  }

  listFiles(sha: string): CommitFileRow[] {
    return this.db
      .prepare(`SELECT ${FILE_COLUMNS} FROM commit_files WHERE sha = ?`)
      .all(sha) as CommitFileRow[];
  }

  latestCommitTimestampForRepo(repoPath: string): number | null {
    const row = this.db
      .prepare(
        "SELECT MAX(authored_at) AS m FROM commits WHERE repo_path = ?",
      )
      .get(repoPath) as { m: number | null } | undefined;
    return row?.m ?? null;
  }

  deleteForRepo(repoPath: string): void {
    this.db.prepare("DELETE FROM commits WHERE repo_path = ?").run(repoPath);
  }
}
