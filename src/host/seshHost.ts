import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import { openDb, type Db } from "../db/connection";
import { runMigrations } from "../db/migrate";
import { SessionRepository } from "../db/sessions";
import { TagRepository } from "../db/tags";
import { CategoryRepository } from "../db/categories";
import { scanProjectsRoot } from "../scanner/scan";
import { scanSessionsIndex } from "../scanner/sessionsIndex";
import { scanCodexSessionsRoot } from "../scanner/codex/scan";
import { extractMetadata } from "../scanner/extract";
import { ContentIndexer } from "../scanner/contentIndexer";
import { ProjectsWatcher } from "../scanner/watcher";
import { TranscriptArchive } from "./transcriptArchive";

const DEFAULT_DB_DIR = path.join(os.homedir(), ".sesh");
const DEFAULT_DB_FILE = path.join(DEFAULT_DB_DIR, "db.sqlite");
const DEFAULT_ARCHIVE_DIR = path.join(DEFAULT_DB_DIR, "transcripts");
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
  public indexProgress: { indexed: number; total: number } = { indexed: 0, total: 0 };
  public onIndexProgress?: () => void;
  public onSessionChanged?: (id: string) => void;
  private scanPromise: Promise<void> | null = null;

  constructor(public readonly output: vscode.OutputChannel) {
    this.archive = new TranscriptArchive(DEFAULT_ARCHIVE_DIR);
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
    fs.mkdirSync(DEFAULT_DB_DIR, { recursive: true });
    this.db = openDb(DEFAULT_DB_FILE);
    runMigrations(this.db);
    this.sessions = new SessionRepository(this.db);
    this.tags = new TagRepository(this.db);
    this.categories = new CategoryRepository(this.db);
    this.output.appendLine(`[sesh] db open: ${DEFAULT_DB_FILE}`);

    this.scanPromise = this.runScan();
    await this.scanPromise;

    void this.healDirtyAutoTitles();

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
      },
    );
    void this.watcher.start();
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

  private async healDirtyAutoTitles(): Promise<void> {
    if (!this.sessions) return;
    const dirty = this.sessions.listIdsWithDirtyAutoTitle();
    if (dirty.length === 0) return;
    this.output.appendLine(
      `[sesh] re-extracting auto_title for ${dirty.length} session${dirty.length === 1 ? "" : "s"}…`,
    );
    let healed = 0;
    for (const row of dirty) {
      try {
        const meta = await extractMetadata(row.file_path, row.id);
        this.sessions.setAutoTitle(row.id, meta.auto_title);
        healed++;
      } catch {
        // ignore — file may be unreadable; leave the row as-is
      }
    }
    this.output.appendLine(
      `[sesh] auto_title heal complete: ${healed}/${dirty.length}`,
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
