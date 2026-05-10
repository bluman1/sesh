import type { Db } from "../db/connection";
import { IdeaRepository } from "../db/ideas";
import { recentCommitments } from "../db/analyticsQueries";
import { basename } from "../util/path";

export interface SessionSuggestion {
  kind: "idea" | "commitment";
  text: string;
  weight: number;
  source_session_ids: string[];
  /** Best-available title of the primary source session (custom > auto). */
  session_title: string | null;
  /** Basename of repo_path (preferred) or project_path. Used to show
   * workspace context in the banner when scope is global. */
  project_label: string | null;
}

interface SessionMeta {
  custom_title: string | null;
  auto_title: string | null;
  repo_path: string | null;
  project_path: string | null;
}

function loadSessionMeta(db: Db, ids: string[]): Map<string, SessionMeta> {
  const out = new Map<string, SessionMeta>();
  if (ids.length === 0) return out;
  const placeholders = ids.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT id, custom_title, auto_title, repo_path, project_path
       FROM sessions
       WHERE id IN (${placeholders})`,
    )
    .all(...ids) as Array<SessionMeta & { id: string }>;
  for (const r of rows) {
    out.set(r.id, {
      custom_title: r.custom_title,
      auto_title: r.auto_title,
      repo_path: r.repo_path,
      project_path: r.project_path,
    });
  }
  return out;
}

function metaToTitleAndProject(meta: SessionMeta | undefined): { title: string | null; project: string | null } {
  if (!meta) return { title: null, project: null };
  const title = meta.custom_title?.trim() || meta.auto_title?.trim() || null;
  const project = basename(meta.repo_path) ?? basename(meta.project_path);
  return { title, project };
}

export function suggestNextSessionTopics(
  db: Db,
  opts?: { limit?: number; repoPath?: string },
): SessionSuggestion[] {
  const limit = opts?.limit ?? 5;
  const raw: SessionSuggestion[] = [];

  // Build repo session id set if filtering by workspace.
  let repoSessionIds: Set<string> | null = null;
  if (opts?.repoPath) {
    const sessionsForRepo = db
      .prepare("SELECT id FROM sessions WHERE repo_path = ?")
      .all(opts.repoPath) as { id: string }[];
    repoSessionIds = new Set(sessionsForRepo.map((r) => r.id));
  }

  // Idea clusters with size >= 2.
  const ideaRepo = new IdeaRepository(db);
  let clusters = ideaRepo.listClusters().filter((c) => c.size >= 2);
  if (repoSessionIds !== null) {
    const ids = repoSessionIds;
    clusters = clusters.filter((c) =>
      c.ideas.some((i) => ids.has(i.source_session_id)),
    );
  }
  for (const c of clusters) {
    const head = c.ideas[0];
    if (!head) continue;
    const recency = Math.max(...c.ideas.map((i) => i.detected_at));
    const ageDays = (Date.now() - recency) / (86400 * 1000);
    const weight = c.size / (1 + ageDays * 0.1);
    raw.push({
      kind: "idea",
      text: head.text,
      weight,
      source_session_ids: [...new Set(c.ideas.map((i) => i.source_session_id))],
      session_title: null,
      project_label: null,
    });
  }

  // Recent commitments.
  let commitmentsList: Array<{ session_id: string; turn_id: string; ts: number; excerpt: string }> = [];
  try {
    commitmentsList = recentCommitments({ db, since: Date.now() - 14 * 86400 * 1000 });
  } catch {
    commitmentsList = [];
  }
  if (repoSessionIds !== null) {
    const ids = repoSessionIds;
    commitmentsList = commitmentsList.filter((c) => ids.has(c.session_id));
  }
  for (const c of commitmentsList) {
    const ageDays = (Date.now() - c.ts) / (86400 * 1000);
    const weight = 1.5 / (1 + ageDays * 0.15);
    raw.push({
      kind: "commitment",
      text: c.excerpt,
      weight,
      source_session_ids: [c.session_id],
      session_title: null,
      project_label: null,
    });
  }

  const top = raw.sort((a, b) => b.weight - a.weight).slice(0, limit);

  // Bulk-load session meta for the primary source sessions, then enrich.
  const primaryIds = Array.from(
    new Set(top.map((s) => s.source_session_ids[0]).filter((id): id is string => Boolean(id))),
  );
  const metaByid = loadSessionMeta(db, primaryIds);
  for (const s of top) {
    const primary = s.source_session_ids[0];
    const { title, project } = metaToTitleAndProject(primary ? metaByid.get(primary) : undefined);
    s.session_title = title;
    s.project_label = project;
  }

  return top;
}
