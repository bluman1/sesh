import type { Db } from "./connection";

export interface SessionRow {
  id: string;
  source: string;
  project_path: string;
  file_path: string;
  file_mtime: number;
  file_size: number;
  created_at: number;
  last_active_at: number;
  message_count: number;
  auto_title: string | null;
  custom_title: string | null;
  category_id: number | null;
  notes: string | null;
  favorited: 0 | 1;
  archived: 0 | 1;
  orphaned: 0 | 1;
  content_indexed: 0 | 1;
  last_parsed_offset: number;
  tokens_in: number;
  tokens_out: number;
  tokens_cache_read: number;
  tokens_cache_create: number;
  turns_indexed: 0 | 1;
  turns_last_offset: number;
  repo_path: string | null;
}

const COLUMNS =
  "id, source, project_path, file_path, file_mtime, file_size, created_at, last_active_at, message_count, auto_title, custom_title, category_id, notes, favorited, archived, orphaned, content_indexed, last_parsed_offset, tokens_in, tokens_out, tokens_cache_read, tokens_cache_create, turns_indexed, turns_last_offset, repo_path";

export class SessionRepository {
  constructor(private db: Db) {}

  upsert(row: SessionRow): void {
    this.db
      .prepare(
        `INSERT INTO sessions (${COLUMNS}) VALUES (
           @id, @source, @project_path, @file_path, @file_mtime, @file_size,
           @created_at, @last_active_at, @message_count, @auto_title, @custom_title,
           @category_id, @notes, @favorited, @archived, @orphaned, @content_indexed,
           @last_parsed_offset, @tokens_in, @tokens_out, @tokens_cache_read,
           @tokens_cache_create, @turns_indexed, @turns_last_offset, @repo_path
         )
         -- repo_path intentionally excluded — GitIndexer resolves it separately;
         -- a JSONL re-scan must not overwrite it.
         ON CONFLICT(id) DO UPDATE SET
           file_mtime = excluded.file_mtime,
           file_size = excluded.file_size,
           last_active_at = excluded.last_active_at,
           message_count = excluded.message_count,
           auto_title = excluded.auto_title,
           tokens_in = excluded.tokens_in,
           tokens_out = excluded.tokens_out,
           tokens_cache_read = excluded.tokens_cache_read,
           tokens_cache_create = excluded.tokens_cache_create,
           orphaned = 0`,
      )
      .run(row);
  }

  findById(id: string): SessionRow | null {
    const row = this.db
      .prepare(`SELECT ${COLUMNS} FROM sessions WHERE id = ?`)
      .get(id) as SessionRow | undefined;
    return row ?? null;
  }

  findByIds(ids: string[]): Map<string, SessionRow> {
    const map = new Map<string, SessionRow>();
    if (ids.length === 0) return map;
    const placeholders = ids.map(() => "?").join(",");
    const rows = this.db
      .prepare(`SELECT ${COLUMNS} FROM sessions WHERE id IN (${placeholders})`)
      .all(...ids) as SessionRow[];
    for (const r of rows) map.set(r.id, r);
    return map;
  }

  listByProject(projectPath: string): SessionRow[] {
    return this.db
      .prepare(
        `SELECT ${COLUMNS} FROM sessions WHERE project_path = ? ORDER BY last_active_at DESC`,
      )
      .all(projectPath) as SessionRow[];
  }

  listAllNonArchived(): SessionRow[] {
    return this.db
      .prepare(
        `SELECT ${COLUMNS} FROM sessions WHERE archived = 0 ORDER BY last_active_at DESC`,
      )
      .all() as SessionRow[];
  }

  listByProjectNonArchived(projectPath: string): SessionRow[] {
    return this.db
      .prepare(
        `SELECT ${COLUMNS} FROM sessions WHERE project_path = ? AND archived = 0 ORDER BY last_active_at DESC`,
      )
      .all(projectPath) as SessionRow[];
  }

  countAll(): number {
    return (this.db.prepare("SELECT COUNT(*) as c FROM sessions").get() as { c: number }).c;
  }

  getFileStat(id: string): { mtime: number; size: number } | null {
    const row = this.db
      .prepare("SELECT file_mtime, file_size FROM sessions WHERE id = ?")
      .get(id) as { file_mtime: number; file_size: number } | undefined;
    return row ? { mtime: row.file_mtime, size: row.file_size } : null;
  }

  setCustomTitle(id: string, title: string | null): void {
    this.db
      .prepare("UPDATE sessions SET custom_title = ? WHERE id = ?")
      .run(title, id);
  }

  setAutoTitle(id: string, title: string | null): void {
    this.db
      .prepare("UPDATE sessions SET auto_title = ? WHERE id = ?")
      .run(title, id);
  }

  setExtractedMetadata(
    id: string,
    autoTitle: string | null,
    tokens: {
      tokens_in: number;
      tokens_out: number;
      tokens_cache_read: number;
      tokens_cache_create: number;
    },
  ): void {
    this.db
      .prepare(
        `UPDATE sessions SET
           auto_title = ?,
           tokens_in = ?,
           tokens_out = ?,
           tokens_cache_read = ?,
           tokens_cache_create = ?
         WHERE id = ?`,
      )
      .run(
        autoTitle,
        tokens.tokens_in,
        tokens.tokens_out,
        tokens.tokens_cache_read,
        tokens.tokens_cache_create,
        id,
      );
  }

  listIdsWithDirtyAutoTitle(): { id: string; file_path: string; source: string }[] {
    return this.db
      .prepare(
        "SELECT id, file_path, source FROM sessions WHERE auto_title LIKE '<%' AND orphaned = 0",
      )
      .all() as { id: string; file_path: string; source: string }[];
  }

  // Sessions that pre-date the tokens migration: their tokens_* columns are
  // zero but message_count > 0 implies the source JSONL has usage data we
  // never read. Safe to re-extract once at activation; the WHERE clause
  // becomes a no-op after the backfill lands.
  listIdsNeedingTokenBackfill(): { id: string; file_path: string; source: string }[] {
    return this.db
      .prepare(
        `SELECT id, file_path, source FROM sessions
         WHERE orphaned = 0
           AND message_count > 0
           AND tokens_in = 0
           AND tokens_out = 0
           AND tokens_cache_read = 0
           AND tokens_cache_create = 0`,
      )
      .all() as { id: string; file_path: string; source: string }[];
  }

  setCategory(id: string, categoryId: number | null): void {
    this.db
      .prepare("UPDATE sessions SET category_id = ? WHERE id = ?")
      .run(categoryId, id);
  }

  setNotes(id: string, notes: string | null): void {
    this.db
      .prepare("UPDATE sessions SET notes = ? WHERE id = ?")
      .run(notes, id);
  }

  setFavorited(id: string, favorited: boolean): void {
    this.db
      .prepare("UPDATE sessions SET favorited = ? WHERE id = ?")
      .run(favorited ? 1 : 0, id);
  }

  setArchived(id: string, archived: boolean): void {
    this.db
      .prepare("UPDATE sessions SET archived = ? WHERE id = ?")
      .run(archived ? 1 : 0, id);
  }

  markOrphaned(id: string): void {
    this.db
      .prepare("UPDATE sessions SET orphaned = 1 WHERE id = ?")
      .run(id);
  }

  setIndexProgress(id: string, offset: number, indexed: boolean): void {
    this.db
      .prepare(
        "UPDATE sessions SET last_parsed_offset = ?, content_indexed = ? WHERE id = ?",
      )
      .run(offset, indexed ? 1 : 0, id);
  }

  listForIndexing(): {
    id: string;
    file_path: string;
    source: string;
    last_parsed_offset: number;
  }[] {
    return this.db
      .prepare(
        "SELECT id, file_path, source, last_parsed_offset FROM sessions WHERE content_indexed = 0 AND orphaned = 0 ORDER BY last_active_at DESC",
      )
      .all() as {
      id: string;
      file_path: string;
      source: string;
      last_parsed_offset: number;
    }[];
  }

  setTurnsIndexProgress(id: string, offset: number, indexed: boolean): void {
    this.db
      .prepare(
        "UPDATE sessions SET turns_last_offset = ?, turns_indexed = ? WHERE id = ?",
      )
      .run(offset, indexed ? 1 : 0, id);
  }

  listForTurnsIndexing(): {
    id: string;
    file_path: string;
    source: string;
    turns_last_offset: number;
  }[] {
    return this.db
      .prepare(
        "SELECT id, file_path, source, turns_last_offset FROM sessions WHERE turns_indexed = 0 AND orphaned = 0 ORDER BY last_active_at DESC",
      )
      .all() as {
      id: string;
      file_path: string;
      source: string;
      turns_last_offset: number;
    }[];
  }

  listForEmbeddingIndexing(): { id: string; file_path: string }[] {
    return this.db
      .prepare(
        "SELECT id, file_path FROM sessions WHERE turns_indexed = 1 AND orphaned = 0 ORDER BY last_active_at DESC",
      )
      .all() as { id: string; file_path: string }[];
  }

  setRepoPath(id: string, repoPath: string | null): void {
    this.db
      .prepare("UPDATE sessions SET repo_path = ? WHERE id = ?")
      .run(repoPath, id);
  }

  // Returns orphaned sessions too — Reviewer tab needs to show all sessions
  // that ever touched a repo, even if their JSONL has since been deleted.
  // This is intentionally asymmetric with listDistinctRepoPaths /
  // listSessionsNeedingRepoDiscovery, which DO filter on orphaned = 0.
  listSessionsByRepo(repoPath: string): SessionRow[] {
    return this.db
      .prepare(
        `SELECT ${COLUMNS} FROM sessions WHERE repo_path = ? ORDER BY last_active_at DESC`,
      )
      .all(repoPath) as SessionRow[];
  }

  listDistinctRepoPaths(): string[] {
    const rows = this.db
      .prepare(
        "SELECT DISTINCT repo_path FROM sessions WHERE repo_path IS NOT NULL AND orphaned = 0",
      )
      .all() as { repo_path: string }[];
    return rows.map((r) => r.repo_path);
  }

  listSessionsNeedingRepoDiscovery(): { id: string; project_path: string }[] {
    return this.db
      .prepare(
        "SELECT id, project_path FROM sessions WHERE repo_path IS NULL AND orphaned = 0",
      )
      .all() as { id: string; project_path: string }[];
  }

  listRemaps(): { from_path: string; to_path: string }[] {
    return this.db
      .prepare("SELECT from_path, to_path FROM project_remap")
      .all() as { from_path: string; to_path: string }[];
  }

  addRemap(fromPath: string, toPath: string): void {
    this.db
      .prepare(
        "INSERT INTO project_remap (from_path, to_path) VALUES (?, ?) ON CONFLICT(from_path) DO UPDATE SET to_path = excluded.to_path",
      )
      .run(fromPath, toPath);
  }

  removeRemap(fromPath: string): void {
    this.db.prepare("DELETE FROM project_remap WHERE from_path = ?").run(fromPath);
  }
}
