import * as fs from "node:fs";
import type { Db } from "../db/connection";
import type { SessionRepository } from "../db/sessions";
import { CommitRepository } from "../db/commits";
import { runGitLog, runCurrentBranch } from "./runGit";
import { parseGitLog } from "./gitLog";

const HISTORY_FLOOR_MS = 180 * 86400 * 1000; // 180 days

export class GitIndexer {
  private cancelled = false;
  private running: Promise<void> | null = null;
  private onProgress?: (indexed: number, total: number) => void;

  constructor(
    private readonly db: Db,
    private readonly sessions: SessionRepository,
    private readonly commits: CommitRepository,
  ) {}

  setProgressHandler(handler: (indexed: number, total: number) => void): void {
    this.onProgress = handler;
  }

  async run(): Promise<void> {
    if (this.running) return this.running;
    this.cancelled = false;
    this.running = this.doRun().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  cancel(): void {
    this.cancelled = true;
  }

  private async doRun(): Promise<void> {
    const repos = this.sessions.listDistinctRepoPaths();
    const total = repos.length;
    if (total === 0) {
      this.onProgress?.(0, 0);
      return;
    }
    let done = 0;
    this.onProgress?.(0, total);
    for (const repoPath of repos) {
      if (this.cancelled) return;
      try {
        await this.indexRepo(repoPath);
      } catch {
        // ignore single-repo failures; indexer continues
      }
      done++;
      this.onProgress?.(done, total);
    }
  }

  async indexRepo(repoPath: string): Promise<void> {
    if (!this.repoExists(repoPath)) return;

    // Incremental window: from latest indexed commit (minus 1s buffer) OR
    // 180 days back, whichever is later.
    const latest = this.commits.latestCommitTimestampForRepo(repoPath);
    const floor = Date.now() - HISTORY_FLOOR_MS;
    const since = latest !== null
      ? Math.max(latest - 1000, floor)
      : floor;

    const stdout = await runGitLog(repoPath, since);
    const parsed = parseGitLog(stdout, repoPath);
    if (parsed.length === 0) return;

    const branch = await runCurrentBranch(repoPath);

    const tx = this.db.transaction(() => {
      for (const p of parsed) {
        this.commits.upsertCommit({ ...p.commit, branch });
        if (p.files.length > 0) this.commits.upsertFiles(p.files);
      }
    });
    tx();
  }

  private repoExists(repoPath: string): boolean {
    try {
      const stat = fs.statSync(repoPath);
      return stat.isDirectory();
    } catch {
      return false;
    }
  }
}
