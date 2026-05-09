import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { GIT_LOG_FORMAT } from "./gitLog";

const execFileAsync = promisify(execFile);

const MAX_BUFFER = 50 * 1024 * 1024; // 50MB — large enough for monorepo histories

/**
 * Shell `git log` for a repo and return raw stdout.
 * `since` is a UNIX ms epoch; we convert to ISO for git's --since flag.
 * Returns empty string if no commits match.
 */
export async function runGitLog(
  repoPath: string,
  since: number,
): Promise<string> {
  const sinceISO = new Date(since).toISOString();
  const args = [
    "log",
    `--since=${sinceISO}`,
    `--pretty=format:${GIT_LOG_FORMAT}`,
    "--numstat",
    "--no-merges",
  ];
  try {
    const { stdout } = await execFileAsync("git", args, {
      cwd: repoPath,
      maxBuffer: MAX_BUFFER,
    });
    return stdout;
  } catch (err) {
    // Re-throw with cwd info so the indexer can log which repo failed.
    const e = err as Error & { code?: string; stderr?: string };
    const stderr = e.stderr ? `\nstderr: ${e.stderr}` : "";
    throw new Error(`git log failed in ${repoPath}: ${e.message}${stderr}`);
  }
}

/**
 * Get the current branch name in a repo, or null if detached/unknown.
 * Uses --quiet so a detached HEAD doesn't print a warning to stderr.
 */
export async function runCurrentBranch(repoPath: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["symbolic-ref", "--short", "--quiet", "HEAD"],
      { cwd: repoPath, maxBuffer: 1024 * 1024 },
    );
    const name = stdout.trim();
    return name || null;
  } catch {
    return null;
  }
}
