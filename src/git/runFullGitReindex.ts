import type { Db } from "../db/connection";
import type { SessionRepository } from "../db/sessions";
import type { GitIndexer } from "./gitIndexer";
import { discoverRepos } from "./discoverRepos";
import { linkSessionsToCommits } from "./linker";
import { inferOutcomes } from "../scanner/outcomeInferer";

/**
 * Run the full git pipeline:
 *   1. Discover .git roots for any sessions missing repo_path.
 *   2. Index commits + commit_files for every distinct repo_path.
 *   3. Re-link sessions ↔ commits for each repo.
 *   4. Re-run outcome inference to pick up shipped/partial/reverted.
 *
 * All four steps are idempotent. Used by both the eager activation
 * pass and the manual `Sesh: Reindex git` command.
 */
export async function runFullGitReindex(opts: {
  db: Db;
  sessions: SessionRepository;
  gitIndexer: GitIndexer;
  windowDays: number;
}): Promise<void> {
  discoverRepos(opts.sessions);
  await opts.gitIndexer.run();
  for (const repoPath of opts.sessions.listDistinctRepoPaths()) {
    linkSessionsToCommits(opts.db, repoPath);
  }
  inferOutcomes({ db: opts.db, now: Date.now(), windowDays: opts.windowDays });
}
