import * as chokidar from "chokidar";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { extractMetadata } from "./extract";
import { extractCodexMetadata } from "./codex/extract";
import { sessionIdFromCodexFilename } from "./codex/scan";
import { SESH_META_CWD } from "../host/seshPaths";
import type { SessionRepository } from "../db/sessions";
import type { ContentIndexer } from "./contentIndexer";
import type { TurnsIndexer } from "./turnsIndexer";
import type { TranscriptArchive } from "../host/transcriptArchive";

export interface WatcherEvents {
  onSessionChanged?: (id: string) => void;
  onWatcherError?: (err: unknown) => void;
}

export interface WatcherDeps {
  archive?: TranscriptArchive;
  archiveEnabled?: () => boolean;
  turnsIndexer?: TurnsIndexer;
}

export class ProjectsWatcher {
  private claudeWatcher: chokidar.FSWatcher | null = null;
  private codexWatcher: chokidar.FSWatcher | null = null;

  constructor(
    private readonly claudeProjectsRoot: string,
    private readonly codexSessionsRoot: string,
    private readonly sessions: SessionRepository,
    private readonly indexer: ContentIndexer,
    private readonly events: WatcherEvents = {},
    private readonly deps: WatcherDeps = {},
  ) {}

  setTurnsIndexer(indexer: TurnsIndexer): void {
    this.deps.turnsIndexer = indexer;
  }

  async start(): Promise<void> {
    try {
      this.claudeWatcher = chokidar.watch(
        `${this.claudeProjectsRoot}/*/*.jsonl`,
        { persistent: true, ignoreInitial: true },
      );
      this.claudeWatcher.on("add", (p) => void this.handleClaudeAddOrChange(p));
      this.claudeWatcher.on("change", (p) => void this.handleClaudeAddOrChange(p));
      this.claudeWatcher.on("unlink", (p) => void this.handleUnlink(p));
      this.claudeWatcher.on("error", (err) => {
        this.events.onWatcherError?.(err);
      });

      // Codex stores at ~/.codex/sessions/<year>/<month>/<day>/rollout-*.jsonl
      // — three-deep glob. chokidar handles the depth fine.
      this.codexWatcher = chokidar.watch(
        `${this.codexSessionsRoot}/*/*/*/rollout-*.jsonl`,
        { persistent: true, ignoreInitial: true },
      );
      this.codexWatcher.on("add", (p) => void this.handleCodexAddOrChange(p));
      this.codexWatcher.on("change", (p) => void this.handleCodexAddOrChange(p));
      this.codexWatcher.on("unlink", (p) => void this.handleUnlink(p));
      this.codexWatcher.on("error", (err) => {
        this.events.onWatcherError?.(err);
      });
    } catch (err) {
      this.events.onWatcherError?.(err);
    }
  }

  async stop(): Promise<void> {
    if (this.claudeWatcher) {
      await this.claudeWatcher.close();
      this.claudeWatcher = null;
    }
    if (this.codexWatcher) {
      await this.codexWatcher.close();
      this.codexWatcher = null;
    }
  }

  private async handleClaudeAddOrChange(filePath: string): Promise<void> {
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
    if (meta.cwd === SESH_META_CWD) {
      // Sesh's own title-generator session — never surface.
      return;
    }
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
      ...meta.tokens,
      turns_indexed: 0,
      turns_last_offset: 0,
      repo_path: null,
    });
    try {
      await this.indexer.indexOne(id, filePath);
    } catch {
      // ignore
    }
    if (this.deps.turnsIndexer) {
      try {
        await this.deps.turnsIndexer.indexOne(id, filePath, "claude-code");
      } catch {
        // ignore
      }
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

  private async handleCodexAddOrChange(filePath: string): Promise<void> {
    const id = sessionIdFromCodexFilename(filePath);
    if (!id) return;
    let stat;
    try {
      stat = await fs.stat(filePath);
    } catch {
      return;
    }
    let meta;
    try {
      meta = await extractCodexMetadata(filePath);
    } catch {
      // Codex sometimes writes a rollout file before the first session_meta
      // record lands; chokidar's `add` event fires the moment the file is
      // created. Ignore — the next `change` event after meta is written
      // will pick it up.
      return;
    }
    if (meta.cwd === SESH_META_CWD) {
      // Sesh's own title-generator codex session — never surface.
      return;
    }
    this.sessions.upsert({
      id,
      source: "codex",
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
      ...meta.tokens,
      turns_indexed: 0,
      turns_last_offset: 0,
      repo_path: null,
    });
    try {
      await this.indexer.indexOne(id, filePath, "codex");
    } catch {
      // ignore
    }
    if (this.deps.turnsIndexer) {
      try {
        await this.deps.turnsIndexer.indexOne(id, filePath, "codex");
      } catch {
        // ignore
      }
    }
    if (this.deps.archive && this.deps.archiveEnabled?.()) {
      try {
        await this.deps.archive.archiveIfNeeded(filePath, id);
      } catch {
        // ignore
      }
    }
    this.events.onSessionChanged?.(id);
  }

  private async handleUnlink(filePath: string): Promise<void> {
    if (!filePath.endsWith(".jsonl")) return;
    // Both Claude and Codex use the trailing component of their filename as
    // the session id. For Codex's `rollout-<ts>-<uuid>.jsonl` pattern we
    // strip the prefix; for Claude's `<uuid>.jsonl` the basename is the id.
    const codexId = sessionIdFromCodexFilename(filePath);
    const id = codexId ?? path.basename(filePath, ".jsonl");
    this.sessions.markOrphaned(id);
    this.events.onSessionChanged?.(id);
  }
}
