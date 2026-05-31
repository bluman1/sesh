import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import { openDb, type Db } from "../db/connection";
import { runMigrations } from "../db/migrate";
import { withBusyRetry, ifBusyThen, isSqliteBusy } from "../db/retry";
import { SessionRepository } from "../db/sessions";
import { TagRepository } from "../db/tags";
import { CategoryRepository } from "../db/categories";
import { scanProjectsRoot } from "../scanner/scan";
import { scanSessionsIndex } from "../scanner/sessionsIndex";
import { scanCodexSessionsRoot } from "../scanner/codex/scan";
import { extractCodexMetadata } from "../scanner/codex/extract";
import { extractMetadata } from "../scanner/extract";
import { ContentIndexer } from "../scanner/contentIndexer";
import { ProjectsWatcher } from "../scanner/watcher";
import type { TurnsIndexer } from "../scanner/turnsIndexer";
import type { GitIndexer } from "../git/gitIndexer";
import type { EmbeddingIndexer } from "../scanner/embeddingIndexer";
import type { IdeaIndexer } from "../scanner/ideaIndexer";
import type { CorrectionMiner } from "../scanner/correctionMiner";
import type { PromptLinter } from "../scanner/promptLinter";
import type { Embedder } from "../embed/types";
import { TranscriptArchive } from "./transcriptArchive";

const DEFAULT_DB_DIR = path.join(os.homedir(), ".sesh");
const DEFAULT_DB_FILE = path.join(DEFAULT_DB_DIR, "db.sqlite");
const DEFAULT_ARCHIVE_DIR = path.join(DEFAULT_DB_DIR, "transcripts");
const DEV_DB_DIR = path.join(os.homedir(), ".sesh", "dev");
const DEV_DB_FILE = path.join(DEV_DB_DIR, "db.sqlite");
const DEV_ARCHIVE_DIR = path.join(DEV_DB_DIR, "transcripts");
const CLAUDE_PROJECTS_DIR = path.join(os.homedir(), ".claude", "projects");
const CODEX_SESSIONS_DIR = path.join(os.homedir(), ".codex", "sessions");

export class SeshHost {
  private db: Db | null = null;
  public sessions: SessionRepository | null = null;
  public tags: TagRepository | null = null;
  public categories: CategoryRepository | null = null;
  public indexer: ContentIndexer | null = null;
  public archive: TranscriptArchive;
  private watcher: ProjectsWatcher | null = null;
  private turnsIndexer: TurnsIndexer | null = null;
  private gitIndexer: GitIndexer | null = null;
  private embeddingIndexer: EmbeddingIndexer | null = null;
  private ideaIndexer: IdeaIndexer | null = null;
  private correctionMiner: CorrectionMiner | null = null;
  private promptLinter: PromptLinter | null = null;
  private embedder: Embedder | null = null;
  public indexProgress: { indexed: number; total: number } = { indexed: 0, total: 0 };
  public onIndexProgress?: () => void;
  public onSessionChanged?: (id: string) => void;
  private scanPromise: Promise<void> | null = null;
  private scanRetryTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly dbDir: string;
  private readonly dbFile: string;

  constructor(
    public readonly output: vscode.OutputChannel,
    opts?: { dev?: boolean },
  ) {
    if (opts?.dev) {
      this.dbDir = DEV_DB_DIR;
      this.dbFile = DEV_DB_FILE;
      this.archive = new TranscriptArchive(DEV_ARCHIVE_DIR);
    } else {
      this.dbDir = DEFAULT_DB_DIR;
      this.dbFile = DEFAULT_DB_FILE;
      this.archive = new TranscriptArchive(DEFAULT_ARCHIVE_DIR);
    }
  }

  setTurnsIndexer(indexer: TurnsIndexer): void {
    this.turnsIndexer = indexer;
    // If the watcher is already running, update its deps so subsequent
    // file-add/change events trigger TurnsIndexer immediately.
    if (this.watcher) {
      this.watcher.setTurnsIndexer(indexer);
    }
  }

  setGitIndexer(indexer: GitIndexer): void {
    this.gitIndexer = indexer;
  }

  get currentGitIndexer(): GitIndexer | null {
    return this.gitIndexer;
  }

  setEmbeddingIndexer(indexer: EmbeddingIndexer | null): void {
    this.embeddingIndexer = indexer;
  }

  get currentEmbeddingIndexer(): EmbeddingIndexer | null {
    return this.embeddingIndexer;
  }

  setIdeaIndexer(indexer: IdeaIndexer | null): void {
    this.ideaIndexer = indexer;
  }

  get currentIdeaIndexer(): IdeaIndexer | null {
    return this.ideaIndexer;
  }

  setCorrectionMiner(miner: CorrectionMiner | null): void {
    this.correctionMiner = miner;
  }

  get currentCorrectionMiner(): CorrectionMiner | null {
    return this.correctionMiner;
  }

  setPromptLinter(linter: PromptLinter | null): void {
    this.promptLinter = linter;
  }

  get currentPromptLinter(): PromptLinter | null {
    return this.promptLinter;
  }

  setEmbedder(e: Embedder | null): void {
    this.embedder = e;
  }

  get currentEmbedder(): Embedder | null {
    return this.embedder;
  }

  private archiveEnabled(): boolean {
    return vscode.workspace
      .getConfiguration("sesh")
      .get<boolean>("archiveTranscripts", false);
  }

  get rawDb(): Db | null {
    return this.db;
  }

  async start(): Promise<void> {
    fs.mkdirSync(this.dbDir, { recursive: true });
    this.db = openDb(this.dbFile);
    try {
      // Migrations are idempotent (they skip already-applied versions), so a
      // transient cross-window write lock can be safely retried.
      await withBusyRetry(() => runMigrations(this.db!));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.output.appendLine(`[sesh] migration error: ${message}`);
      if (isSqliteBusy(err)) {
        this.output.appendLine(
          `[sesh] The database stayed locked by another VSCode window through startup. Reload this window (Developer: Reload Window) to retry.`,
        );
      } else {
        this.output.appendLine(
          `[sesh] If this is a stale DB from an older Sesh build, the safe recovery is:`,
        );
        this.output.appendLine(`[sesh]   1. Close VSCode`);
        this.output.appendLine(`[sesh]   2. mv ${this.dbFile} ${this.dbFile}.bak`);
        this.output.appendLine(
          `[sesh]   3. Reopen VSCode — Sesh will rebuild the index from your source JSONLs.`,
        );
        this.output.appendLine(
          `[sesh]      (Annotations will be reset; the source JSONL files are untouched.)`,
        );
      }
      throw err;
    }
    this.sessions = new SessionRepository(this.db);
    this.tags = new TagRepository(this.db);
    this.categories = new CategoryRepository(this.db);
    this.output.appendLine(`[sesh] db open: ${this.dbFile}`);

    // Best-effort initial scan. A transient cross-window write lock must NOT
    // abort activation — otherwise this window is left with no panel ("Sesh
    // is not running"). Reads work regardless (WAL), so the panel opens from
    // existing data and the scan retries in the background.
    this.scanPromise = this.runScan();
    await ifBusyThen(
      () => this.scanPromise!,
      () => {
        this.output.appendLine(
          `[sesh] initial scan deferred — database busy (another window is indexing). Panel opens from existing data; retrying scan in the background.`,
        );
        this.scheduleBackgroundScan();
      },
    );

    void this.healSessionMetadata();

    this.indexer = new ContentIndexer(this.db, this.sessions);
    this.indexer.setProgressHandler((indexed, total) => {
      this.indexProgress = { indexed, total };
      this.onIndexProgress?.();
    });
    void this.indexer.run().then(() => {
      this.output.appendLine(`[sesh] content index complete`);
    });

    this.watcher = new ProjectsWatcher(
      CLAUDE_PROJECTS_DIR,
      CODEX_SESSIONS_DIR,
      this.sessions,
      this.indexer,
      {
        onSessionChanged: (id) => this.onSessionChanged?.(id),
        onWatcherError: (err) => {
          this.output.appendLine(
            `[sesh] watcher error: ${err instanceof Error ? err.message : String(err)} — run "Sesh: Rescan all projects" to refresh`,
          );
        },
      },
      {
        archive: this.archive,
        archiveEnabled: () => this.archiveEnabled(),
        turnsIndexer: this.turnsIndexer ?? undefined,
      },
    );
    void this.watcher.start();
  }

  /**
   * Re-run the initial scan in the background after a transient lock deferred
   * it, backing off and giving up after a bounded number of tries. The file
   * watcher still catches new sessions live; this only recovers the startup
   * backlog that was locked out.
   */
  private scheduleBackgroundScan(attempt = 1): void {
    const maxAttempts = 6;
    const delay = Math.min(30_000, 2000 * attempt);
    if (this.scanRetryTimer) clearTimeout(this.scanRetryTimer);
    this.scanRetryTimer = setTimeout(() => {
      this.scanRetryTimer = null;
      void this.runScan()
        .then(() => {
          this.output.appendLine(
            `[sesh] background scan succeeded (attempt ${attempt}).`,
          );
          void this.indexer?.run();
          this.onSessionChanged?.("");
        })
        .catch((err) => {
          if (isSqliteBusy(err) && attempt < maxAttempts) {
            this.scheduleBackgroundScan(attempt + 1);
          } else {
            this.output.appendLine(
              `[sesh] background scan gave up after ${attempt} attempt${attempt === 1 ? "" : "s"}: ${err instanceof Error ? err.message : String(err)} — run "Sesh: Rescan all projects" to refresh.`,
            );
          }
        });
    }, delay);
  }

  private async runScan(): Promise<void> {
    if (!this.sessions) return;
    const result = await scanProjectsRoot(CLAUDE_PROJECTS_DIR, this.sessions);
    this.output.appendLine(
      `[sesh] scan complete: scanned=${result.scanned} upserted=${result.upserted} skipped=${result.skipped}`,
    );
    const ghosts = await scanSessionsIndex(CLAUDE_PROJECTS_DIR, this.sessions);
    if (ghosts.indexFiles > 0) {
      this.output.appendLine(
        `[sesh] sessions-index: indexFiles=${ghosts.indexFiles} importedGhosts=${ghosts.imported} skippedExisting=${ghosts.skippedExisting} skippedSidechain=${ghosts.skippedSidechain}`,
      );
    }
    const codex = await scanCodexSessionsRoot(
      CODEX_SESSIONS_DIR,
      this.sessions,
    );
    if (codex.scanned > 0 || codex.upserted > 0) {
      this.output.appendLine(
        `[sesh] codex scan: scanned=${codex.scanned} upserted=${codex.upserted} skipped=${codex.skipped} errored=${codex.errored}`,
      );
    }
    if (this.archiveEnabled()) {
      void this.runArchive();
    }
  }

  private async runArchive(): Promise<void> {
    if (!this.sessions) return;
    const rows = this.sessions.listAllNonArchived();
    let archived = 0;
    for (const row of rows) {
      if (row.orphaned === 1) continue;
      try {
        const wrote = await this.archive.archiveIfNeeded(row.file_path, row.id);
        if (wrote) archived++;
      } catch {
        // skip files we can't read
      }
    }
    if (archived > 0) {
      this.output.appendLine(`[sesh] archive: wrote ${archived} transcripts`);
    }
  }

  private async healSessionMetadata(): Promise<void> {
    if (!this.sessions) return;
    // Two reasons a session might need a re-extract: an auto_title that
    // still contains a `<system-tag>` we now strip, OR token columns that
    // pre-date the 003_tokens migration (zero across all four columns even
    // though the session has messages). Combine into one pass.
    const dirty = this.sessions.listIdsWithDirtyAutoTitle();
    const needTokens = this.sessions.listIdsNeedingTokenBackfill();
    const seen = new Set<string>();
    const rows: { id: string; file_path: string; source: string }[] = [];
    for (const r of [...dirty, ...needTokens]) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      rows.push(r);
    }
    if (rows.length === 0) return;
    this.output.appendLine(
      `[sesh] re-extracting metadata for ${rows.length} session${rows.length === 1 ? "" : "s"}…`,
    );
    let healed = 0;
    for (const row of rows) {
      try {
        if (row.source === "codex") {
          const meta = await extractCodexMetadata(row.file_path);
          this.sessions.setExtractedMetadata(
            row.id,
            meta.auto_title,
            meta.tokens,
          );
        } else {
          const meta = await extractMetadata(row.file_path, row.id);
          this.sessions.setExtractedMetadata(
            row.id,
            meta.auto_title,
            meta.tokens,
          );
        }
        healed++;
      } catch {
        // ignore — file may be unreadable; leave the row as-is
      }
    }
    this.output.appendLine(
      `[sesh] metadata heal complete: ${healed}/${rows.length}`,
    );
    this.onSessionChanged?.("");
  }

  async rescan(): Promise<void> {
    if (!this.sessions || !this.indexer) return;
    const result = await scanProjectsRoot(CLAUDE_PROJECTS_DIR, this.sessions);
    this.output.appendLine(
      `[sesh] manual rescan: scanned=${result.scanned} upserted=${result.upserted} skipped=${result.skipped}`,
    );
    const codex = await scanCodexSessionsRoot(
      CODEX_SESSIONS_DIR,
      this.sessions,
    );
    if (codex.scanned > 0) {
      this.output.appendLine(
        `[sesh] manual rescan codex: scanned=${codex.scanned} upserted=${codex.upserted} skipped=${codex.skipped} errored=${codex.errored}`,
      );
    }
    void this.indexer.run();
    this.onSessionChanged?.("");
  }

  async stop(): Promise<void> {
    if (this.scanRetryTimer) {
      clearTimeout(this.scanRetryTimer);
      this.scanRetryTimer = null;
    }
    if (this.scanPromise) {
      try {
        await this.scanPromise;
      } catch {
        // surfaced separately by start()
      }
    }
    this.indexer?.cancel();
    if (this.watcher) {
      await this.watcher.stop();
      this.watcher = null;
    }
    if (this.db) {
      this.db.close();
      this.db = null;
      this.sessions = null;
      this.tags = null;
      this.categories = null;
      this.indexer = null;
    }
  }
}
