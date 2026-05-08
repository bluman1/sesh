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
}

const COLUMNS =
  "id, source, project_path, file_path, file_mtime, file_size, created_at, last_active_at, message_count, auto_title, custom_title, category_id, notes, favorited, archived, orphaned, content_indexed, last_parsed_offset";

export class SessionRepository {
  constructor(private db: Db) {}

  upsert(row: SessionRow): void {
    this.db
      .prepare(
        `INSERT INTO sessions (${COLUMNS}) VALUES (
           @id, @source, @project_path, @file_path, @file_mtime, @file_size,
           @created_at, @last_active_at, @message_count, @auto_title, @custom_title,
           @category_id, @notes, @favorited, @archived, @orphaned, @content_indexed,
           @last_parsed_offset
         )
         ON CONFLICT(id) DO UPDATE SET
           file_mtime = excluded.file_mtime,
           file_size = excluded.file_size,
           last_active_at = excluded.last_active_at,
           message_count = excluded.message_count,
           auto_title = excluded.auto_title,
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

  listForIndexing(): { id: string; file_path: string; last_parsed_offset: number }[] {
    return this.db
      .prepare(
        "SELECT id, file_path, last_parsed_offset FROM sessions WHERE content_indexed = 0 AND orphaned = 0 ORDER BY last_active_at DESC",
      )
      .all() as { id: string; file_path: string; last_parsed_offset: number }[];
  }
}
