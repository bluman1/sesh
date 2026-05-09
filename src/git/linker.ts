import type { Db } from "../db/connection";
import { SessionCommitRepository } from "../db/sessionCommits";

const TIME_BUFFER_AFTER_MS = 60 * 60 * 1000; // 1 hour after last_active_at
const CONFIDENCE_THRESHOLD = 0.2;
const TIME_MISS_DECAY = 0.3;

interface CandidateRow {
  session_id: string;
  session_created: number;
  session_last_active: number;
  commit_sha: string;
  commit_at: number;
  session_path: string; // tool_call target_path
  commit_path: string;  // commit_files path
}

/**
 * Compute (session, commit) confidence for every (session, commit) pair
 * in the given repo where the session's tool_calls touched at least one
 * file the commit also touched, and write rows above the threshold.
 *
 * Confidence formula:
 *   file_overlap = jaccard(session_files, commit_files)
 *   time_overlap = commit_at within [session_created, session_last_active + 1h]
 *   confidence = file_overlap * (time_overlap ? 1.0 : 0.3)
 *
 * A row is written iff confidence >= 0.2.
 */
export function linkSessionsToCommits(db: Db, repoPath: string): void {
  // Pull every (session, commit, overlapping_path) triple in one query —
  // the join is the heavy part; the math is cheap. Then aggregate in JS.
  const rows = db
    .prepare(
      `SELECT
         s.id           AS session_id,
         s.created_at   AS session_created,
         s.last_active_at AS session_last_active,
         c.sha          AS commit_sha,
         c.authored_at  AS commit_at,
         tc.target_path AS session_path,
         cf.path        AS commit_path
       FROM sessions s
       JOIN tool_calls tc ON tc.session_id = s.id
       JOIN commit_files cf
         ON cf.path = (
           CASE
             WHEN tc.target_path LIKE s.repo_path || '/%'
               THEN substr(tc.target_path, length(s.repo_path) + 2)
             ELSE tc.target_path
           END
         )
       JOIN commits c ON c.sha = cf.sha
       WHERE s.repo_path = ?
         AND c.repo_path = ?
         AND tc.target_path IS NOT NULL`,
    )
    .all(repoPath, repoPath) as CandidateRow[];

  // Aggregate per (session_id, commit_sha):
  //   sessionFiles, commitFiles, overlap
  // We need the SIZES of session.files and commit.files to compute jaccard
  // properly; the join above only gives us the intersection. Look those up.
  type Pair = { sessionFiles: Set<string>; commitFiles: Set<string>; overlap: Set<string>; commit_at: number; session_created: number; session_last_active: number };
  const pairs = new Map<string, Pair>();
  for (const r of rows) {
    const key = `${r.session_id}|${r.commit_sha}`;
    let p = pairs.get(key);
    if (!p) {
      p = {
        sessionFiles: new Set<string>(),
        commitFiles: new Set<string>(),
        overlap: new Set<string>(),
        commit_at: r.commit_at,
        session_created: r.session_created,
        session_last_active: r.session_last_active,
      };
      pairs.set(key, p);
    }
    p.overlap.add(r.commit_path);
  }

  // Pull session-file-set sizes and commit-file-set sizes separately.
  // Cheaper than dragging full sets through the big join.
  const sessionFileCounts = new Map<string, number>();
  const sfRows = db
    .prepare(
      `SELECT session_id, COUNT(DISTINCT
         CASE WHEN target_path LIKE ? || '/%'
           THEN substr(target_path, length(?) + 2)
           ELSE target_path
         END) AS c
       FROM tool_calls
       WHERE target_path IS NOT NULL
         AND session_id IN (SELECT id FROM sessions WHERE repo_path = ?)
       GROUP BY session_id`,
    )
    .all(repoPath, repoPath, repoPath) as { session_id: string; c: number }[];
  for (const r of sfRows) sessionFileCounts.set(r.session_id, r.c);

  const commitFileCounts = new Map<string, number>();
  const cfRows = db
    .prepare(
      `SELECT sha, COUNT(*) AS c FROM commit_files
       WHERE sha IN (SELECT sha FROM commits WHERE repo_path = ?)
       GROUP BY sha`,
    )
    .all(repoPath) as { sha: string; c: number }[];
  for (const r of cfRows) commitFileCounts.set(r.sha, r.c);

  const linksToWrite: { session_id: string; commit_sha: string; confidence: number }[] = [];
  for (const [key, p] of pairs) {
    const [session_id, commit_sha] = key.split("|");
    const sf = sessionFileCounts.get(session_id) ?? 0;
    const cf = commitFileCounts.get(commit_sha) ?? 0;
    const intersection = p.overlap.size;
    const union = sf + cf - intersection;
    if (union <= 0) continue;
    const fileOverlap = intersection / union;

    const inWindow =
      p.commit_at >= p.session_created &&
      p.commit_at <= p.session_last_active + TIME_BUFFER_AFTER_MS;
    const confidence = fileOverlap * (inWindow ? 1.0 : TIME_MISS_DECAY);

    if (confidence >= CONFIDENCE_THRESHOLD) {
      linksToWrite.push({ session_id, commit_sha, confidence });
    }
  }

  if (linksToWrite.length > 0) {
    new SessionCommitRepository(db).upsertMany(linksToWrite);
  }
}
