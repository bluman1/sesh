import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Walk up from a starting path looking for a .git directory or file.
 * Git worktrees use a .git FILE pointing at the real gitdir; either
 * variant is treated as "this is inside a repo, top is here".
 *
 * Returns the absolute path of the repo root, or null if no .git is
 * found before reaching the filesystem root.
 */
export function findRepoRoot(start: string): string | null {
  if (!start) return null;
  let current = path.resolve(start);
  while (true) {
    const dotGit = path.join(current, ".git");
    let exists = false;
    try {
      fs.statSync(dotGit);
      exists = true;
    } catch {
      // ENOENT — keep walking
    }
    if (exists) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}
