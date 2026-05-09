import * as fs from "node:fs/promises";
import * as fsSync from "node:fs";
import * as path from "node:path";
import { stripSystemTags } from "./systemTags";
import type { SessionRepository } from "../db/sessions";

/**
 * Claude Code maintains a `sessions-index.json` per encoded project directory
 * that lists every session ever started in that folder — including ones whose
 * transcript JSONL has since been pruned. Sesh imports those entries as
 * 'ghost' rows (orphaned = 1) so the user keeps a record + annotations even
 * after the underlying transcript is gone.
 */

interface SessionsIndexEntry {
  sessionId: string;
  fullPath?: string;
  fileMtime?: number;
  firstPrompt?: string;
  summary?: string;
  messageCount?: number;
  created?: string;
  modified?: string;
  projectPath?: string;
  isSidechain?: boolean;
}

interface SessionsIndex {
  version: number;
  originalPath: string;
  entries: SessionsIndexEntry[];
}

export interface GhostScanResult {
  indexFiles: number;
  imported: number;
  skippedExisting: number;
  skippedSidechain: number;
}

export async function scanSessionsIndex(
  projectsRoot: string,
  repo: SessionRepository,
): Promise<GhostScanResult> {
  const result: GhostScanResult = {
    indexFiles: 0,
    imported: 0,
    skippedExisting: 0,
    skippedSidechain: 0,
  };
  let dirs: string[];
  try {
    dirs = await fs.readdir(projectsRoot);
  } catch {
    return result;
  }
  for (const dirName of dirs) {
    const indexPath = path.join(projectsRoot, dirName, "sessions-index.json");
    let raw: string;
    try {
      raw = await fs.readFile(indexPath, "utf-8");
    } catch {
      continue;
    }
    let data: SessionsIndex;
    try {
      data = JSON.parse(raw);
    } catch {
      continue;
    }
    if (!Array.isArray(data.entries)) continue;
    result.indexFiles++;
    for (const entry of data.entries) {
      if (entry.isSidechain) {
        result.skippedSidechain++;
        continue;
      }
      if (!entry.sessionId) continue;
      if (repo.findById(entry.sessionId)) {
        result.skippedExisting++;
        continue;
      }
      if (entry.fullPath && fsSync.existsSync(entry.fullPath)) {
        // The JSONL still exists; the JSONL scan will pick it up.
        result.skippedExisting++;
        continue;
      }
      const summary = entry.summary?.trim();
      const stripped = entry.firstPrompt
        ? stripSystemTags(entry.firstPrompt)
        : "";
      const title = (summary || stripped || "(transcript pruned)").slice(
        0,
        80,
      );
      const created = entry.created ? Date.parse(entry.created) : 0;
      const modified = entry.modified ? Date.parse(entry.modified) : created;
      repo.upsert({
        id: entry.sessionId,
        source: "claude-code",
        project_path: entry.projectPath || data.originalPath || "",
        file_path: entry.fullPath || "",
        file_mtime: entry.fileMtime ?? 0,
        file_size: 0,
        created_at: Number.isFinite(created) ? created : 0,
        last_active_at: Number.isFinite(modified) ? modified : 0,
        message_count: entry.messageCount ?? 0,
        auto_title: title,
        custom_title: null,
        category_id: null,
        notes: null,
        favorited: 0,
        archived: 0,
        orphaned: 1,
        content_indexed: 0,
        last_parsed_offset: 0,
        // Ghost rows have no transcript on disk to extract usage from.
        tokens_in: 0,
        tokens_out: 0,
        tokens_cache_read: 0,
        tokens_cache_create: 0,
        turns_indexed: 0,
        turns_last_offset: 0,
        repo_path: null,
      });
      result.imported++;
    }
  }
  return result;
}
