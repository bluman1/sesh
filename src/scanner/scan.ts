import * as fs from "node:fs/promises";
import * as path from "node:path";
import { extractMetadata } from "./extract";
import type { SessionRepository } from "../db/sessions";

export interface ScanResult {
  scanned: number;
  upserted: number;
  skipped: number;
}

export async function scanProjectsRoot(
  projectsRoot: string,
  repo: SessionRepository,
): Promise<ScanResult> {
  const result: ScanResult = { scanned: 0, upserted: 0, skipped: 0 };
  let dirs: string[];
  try {
    dirs = await fs.readdir(projectsRoot);
  } catch {
    return result;
  }
  for (const dirName of dirs) {
    const dirPath = path.join(projectsRoot, dirName);
    let stat;
    try {
      stat = await fs.stat(dirPath);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) continue;

    let files: string[];
    try {
      files = await fs.readdir(dirPath);
    } catch {
      continue;
    }
    for (const fileName of files) {
      if (!fileName.endsWith(".jsonl")) continue;
      const filePath = path.join(dirPath, fileName);
      const fileStat = await fs.stat(filePath);
      const id = fileName.replace(/\.jsonl$/, "");
      result.scanned++;

      const existingMtime = repo.getMtime(id);
      if (
        existingMtime !== null &&
        existingMtime === fileStat.mtimeMs
      ) {
        result.skipped++;
        continue;
      }

      const meta = await extractMetadata(filePath, id, {
        fallbackEncodedDir: dirName,
      });
      repo.upsert({
        id,
        source: "claude-code",
        project_path: meta.cwd,
        file_path: filePath,
        file_mtime: fileStat.mtimeMs,
        file_size: fileStat.size,
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
      });
      result.upserted++;
    }
  }
  return result;
}
