import type { Db } from "../db/connection";
import { OutcomeRepository, type OutcomeState } from "../db/outcomes";

export interface InferOpts {
  db: Db;
  now: number;
  windowDays: number;
}

const SHIPPED_THRESHOLD = 0.5;
const PARTIAL_THRESHOLD = 0.2;

interface SessionOverview {
  id: string;
  last_active_at: number;
  top_confidence: number | null;
  is_reverted: 0 | 1;
}

/**
 * Outcome inference for substrate 1 + substrate 3:
 *   reverted    → a 'Revert "..."' commit touches files this session edited
 *                 AND the original session has at least one linked commit
 *   shipped      → top linked commit confidence >= 0.5
 *   shipped-partial → 0.2 <= confidence < 0.5
 *   abandoned    → no linked commit, last_active >= windowDays ago
 *   open         → otherwise
 *
 * setInferred respects user_marked, so any user-pinned outcome wins.
 */
export function inferOutcomes(opts: InferOpts): void {
  const outcomes = new OutcomeRepository(opts.db);
  const cutoff = opts.now - opts.windowDays * 86400 * 1000;

  // One pass: compute per-session top confidence and a revert flag.
  const rows = opts.db
    .prepare(
      `SELECT
         s.id AS id,
         s.last_active_at AS last_active_at,
         (SELECT MAX(sc.confidence) FROM session_commits sc WHERE sc.session_id = s.id) AS top_confidence,
         CASE WHEN EXISTS (
           -- A revert commit (message starts with 'Revert "') that touches
           -- a path also touched by one of this session's linked commits.
           SELECT 1
             FROM commits revert
             JOIN commit_files revert_files ON revert_files.sha = revert.sha
             JOIN commit_files orig_files ON orig_files.path = revert_files.path
             JOIN session_commits sc
               ON sc.commit_sha = orig_files.sha
              AND sc.session_id = s.id
            WHERE revert.repo_path = s.repo_path
              AND revert.message LIKE 'Revert "%'
              AND revert.authored_at > orig_files.sha IS NOT NULL
              AND revert.sha != sc.commit_sha
         ) THEN 1 ELSE 0 END AS is_reverted
       FROM sessions s
       WHERE s.archived = 0 AND s.orphaned = 0`,
    )
    .all() as SessionOverview[];

  for (const r of rows) {
    let state: OutcomeState;
    if (r.is_reverted === 1) {
      state = "reverted";
    } else if (r.top_confidence !== null && r.top_confidence >= SHIPPED_THRESHOLD) {
      state = "shipped";
    } else if (r.top_confidence !== null && r.top_confidence >= PARTIAL_THRESHOLD) {
      state = "shipped-partial";
    } else if (r.last_active_at < cutoff) {
      state = "abandoned";
    } else {
      state = "open";
    }
    outcomes.setInferred(r.id, state);
  }
}
