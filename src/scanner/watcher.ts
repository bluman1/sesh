import * as chokidar from "chokidar";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { extractMetadata } from "./extract";
import type { SessionRepository } from "../db/sessions";
import type { ContentIndexer } from "./contentIndexer";
import type { TranscriptArchive } from "../host/transcriptArchive";

export interface WatcherEvents {
  onSessionChanged?: (id: string) => void;
  onWatcherError?: (err: unknown) => void;
}

export interface WatcherDeps {
  archive?: TranscriptArchive;
  archiveEnabled?: () => boolean;
}

export class ProjectsWatcher {
  private watcher: chokidar.FSWatcher | null = null;

  constructor(
    private readonly projectsRoot: string,
    private readonly sessions: SessionRepository,
    private readonly indexer: ContentIndexer,
    private readonly events: WatcherEvents = {},
    private readonly deps: WatcherDeps = {},
  ) {}

  async start(): Promise<void> {
    try {
      this.watcher = chokidar.watch(`${this.projectsRoot}/*/*.jsonl`, {
        persistent: true,
        ignoreInitial: true,
      });
      this.watcher.on("add", (p) => void this.handleAddOrChange(p));
      this.watcher.on("change", (p) => void this.handleAddOrChange(p));
      this.watcher.on("unlink", (p) => void this.handleUnlink(p));
      this.watcher.on("error", (err) => {
        // Surface the failure so the user knows live updates are off; the
        // Sesh: Rescan command is the recovery path. We don't fall back to
        // a polling timer — a no-op interval just kept the process alive
        // without doing useful work.
        this.events.onWatcherError?.(err);
      });
    } catch (err) {
      this.events.onWatcherError?.(err);
    }
  }

  async stop(): Promise<void> {
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }
  }

  private async handleAddOrChange(filePath: string): Promise<void> {
    if (!filePath.endsWith(".jsonl")) return;
    const id = path.basename(filePath, ".jsonl");
    let stat;
    try {
      stat = await fs.stat(filePath);
    } catch {
      return;
    }
    const dirName = path.basename(path.dirname(filePath));
    const meta = await extractMetadata(filePath, id, {
      fallbackEncodedDir: dirName,
    });
    this.sessions.upsert({
      id,
      source: "claude-code",
      project_path: meta.cwd,
      file_path: filePath,
      file_mtime: stat.mtimeMs,
      file_size: stat.size,
      created_at: meta.created_at,
      last_active_at: meta.last_active_at,
      message_count: meta.message_count,
      auto_title: meta.auto_title,
      custom_title: null,
      category_id: null,
      notes: null,
      favorited: 0,
      archived: 0,
      orphaned: 0,
      content_indexed: 0,
      last_parsed_offset: 0,
    });
    try {
      await this.indexer.indexOne(id, filePath);
    } catch {
      // ignore
    }
    if (this.deps.archive && this.deps.archiveEnabled?.()) {
      try {
        await this.deps.archive.archiveIfNeeded(filePath, id);
      } catch {
        // ignore archive failure; the row is still up-to-date
      }
    }
    this.events.onSessionChanged?.(id);
  }

  private async handleUnlink(filePath: string): Promise<void> {
    if (!filePath.endsWith(".jsonl")) return;
    const id = path.basename(filePath, ".jsonl");
    this.sessions.markOrphaned(id);
    this.events.onSessionChanged?.(id);
  }
}
