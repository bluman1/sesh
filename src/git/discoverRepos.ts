import type { SessionRepository } from "../db/sessions";
import { findRepoRoot } from "./repoDiscovery";

/**
 * For every session with repo_path = NULL, walk up from project_path
 * to find the enclosing git repo and cache the answer. Sessions in
 * non-git dirs stay NULL forever (the next discovery call won't waste
 * work on them either way; we re-walk them once per call which is
 * cheap on warm filesystem caches).
 */
export function discoverRepos(sessions: SessionRepository): void {
  const candidates = sessions.listSessionsNeedingRepoDiscovery();
  for (const c of candidates) {
    const repoPath = findRepoRoot(c.project_path);
    // Always set, even if null, to avoid re-walking next call.
    // Note: setRepoPath(null) is a no-op against the existing NULL,
    // but for symmetry we still call it. SQLite UPDATEs are cheap.
    if (repoPath !== null) {
      sessions.setRepoPath(c.id, repoPath);
    }
  }
}
