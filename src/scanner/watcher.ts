import * as chokidar from "chokidar";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { extractMetadata } from "./extract";
import type { SessionRepository } from "../db/sessions";
import type { ContentIndexer } from "./contentIndexer";

export interface WatcherEvents {
  onSessionChanged?: (id: string) => void;
}

export class ProjectsWatcher {
  private watcher: chokidar.FSWatcher | null = null;
  private pollTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly projectsRoot: string,
    private readonly sessions: SessionRepository,
    private readonly indexer: ContentIndexer,
    private readonly events: WatcherEvents = {},
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
      this.watcher.on("error", () => {
        this.startPolling();
      });
    } catch {
      this.startPolling();
    }
  }

  async stop(): Promise<void> {
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private startPolling(): void {
    if (this.pollTimer) return;
    this.pollTimer = setInterval(() => {
      // poll mode is a no-op; SeshHost re-scan command is the recovery path.
    }, 30000);
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
    this.events.onSessionChanged?.(id);
  }

  private async handleUnlink(filePath: string): Promise<void> {
    if (!filePath.endsWith(".jsonl")) return;
    const id = path.basename(filePath, ".jsonl");
    this.sessions.markOrphaned(id);
    this.events.onSessionChanged?.(id);
  }
}
