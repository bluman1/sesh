import type { Db } from "./connection";
import type { SessionRow } from "./sessions";

export interface SearchFilters {
  scope: "current" | "all" | "folder";
  currentPath: string | null;
  selectedFolderPath?: string | null;
  query: string;
  category_ids: number[];
  tags: string[];
  favorited: boolean | null;
  archived: boolean | null;
}

const COLUMNS =
  "s.id, s.source, s.project_path, s.file_path, s.file_mtime, s.file_size, s.created_at, s.last_active_at, s.message_count, s.auto_title, s.custom_title, s.category_id, s.notes, s.favorited, s.archived, s.orphaned, s.content_indexed, s.last_parsed_offset";

export function searchSessions(db: Db, f: SearchFilters): SessionRow[] {
  const conditions: string[] = [];
  const params: Record<string, unknown> = {};

  if (f.archived === false) conditions.push("s.archived = 0");
  else if (f.archived === true) conditions.push("s.archived = 1");

  if (f.favorited === true) conditions.push("s.favorited = 1");
  else if (f.favorited === false) conditions.push("s.favorited = 0");

  if (f.scope === "current") {
    // Without a workspace folder open we can't filter to "current" — return nothing
    // explicitly rather than silently falling through to all sessions.
    if (!f.currentPath) {
      return [];
    }
    // Find remapped from_paths that point to currentPath, include them in the OR
    const remapRows = db
      .prepare("SELECT from_path FROM project_remap WHERE to_path = ?")
      .all(f.currentPath) as { from_path: string }[];
    const paths = [f.currentPath, ...remapRows.map((r) => r.from_path)];
    const placeholders = paths.map((_, i) => `@p${i}`).join(", ");
    conditions.push(`s.project_path IN (${placeholders})`);
    paths.forEach((p, i) => {
      params[`p${i}`] = p;
    });
  } else if (f.scope === "folder") {
    if (!f.selectedFolderPath) {
      return [];
    }
    const remapRows = db
      .prepare("SELECT from_path FROM project_remap WHERE to_path = ?")
      .all(f.selectedFolderPath) as { from_path: string }[];
    const paths = [
      f.selectedFolderPath,
      ...remapRows.map((r) => r.from_path),
    ];
    const placeholders = paths.map((_, i) => `@p${i}`).join(", ");
    conditions.push(`s.project_path IN (${placeholders})`);
    paths.forEach((p, i) => {
      params[`p${i}`] = p;
    });
  }

  if (f.category_ids.length > 0) {
    const placeholders = f.category_ids.map((_, i) => `@cat${i}`).join(", ");
    conditions.push(`s.category_id IN (${placeholders})`);
    f.category_ids.forEach((id, i) => {
      params[`cat${i}`] = id;
    });
  }

  if (f.tags.length > 0) {
    f.tags.forEach((tag, i) => {
      conditions.push(
        `EXISTS (SELECT 1 FROM tags t WHERE t.session_id = s.id AND t.tag = @tag${i})`,
      );
      params[`tag${i}`] = tag;
    });
  }

  if (f.query.trim()) {
    const q = f.query.trim();
    const like = `%${q.replace(/[%_]/g, "\\$&")}%`;
    params.like = like;
    params.fts = q.replace(/"/g, '""');
    conditions.push(`(
      s.custom_title LIKE @like ESCAPE '\\' OR
      s.auto_title LIKE @like ESCAPE '\\' OR
      s.notes LIKE @like ESCAPE '\\' OR
      EXISTS (SELECT 1 FROM tags t WHERE t.session_id = s.id AND t.tag LIKE @like ESCAPE '\\') OR
      EXISTS (SELECT 1 FROM session_content_fts fts WHERE fts.session_id = s.id AND fts.content MATCH @fts)
    )`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const sql = `SELECT ${COLUMNS} FROM sessions s ${where} ORDER BY s.last_active_at DESC`;
  return db.prepare(sql).all(params) as SessionRow[];
}
