import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import { openDb, type Db } from "../db/connection";
import { runMigrations } from "../db/migrate";
import { SessionRepository } from "../db/sessions";
import { scanProjectsRoot } from "../scanner/scan";

const DEFAULT_DB_DIR = path.join(os.homedir(), ".sesh");
const DEFAULT_DB_FILE = path.join(DEFAULT_DB_DIR, "db.sqlite");
const CLAUDE_PROJECTS_DIR = path.join(os.homedir(), ".claude", "projects");

export class SeshHost {
  private db: Db | null = null;
  public sessions: SessionRepository | null = null;
  private scanPromise: Promise<void> | null = null;

  constructor(public readonly output: vscode.OutputChannel) {}

  async start(): Promise<void> {
    fs.mkdirSync(DEFAULT_DB_DIR, { recursive: true });
    this.db = openDb(DEFAULT_DB_FILE);
    runMigrations(this.db);
    this.sessions = new SessionRepository(this.db);
    this.output.appendLine(`[sesh] db open: ${DEFAULT_DB_FILE}`);

    this.scanPromise = this.runScan();
    await this.scanPromise;
  }

  private async runScan(): Promise<void> {
    if (!this.sessions) return;
    const result = await scanProjectsRoot(CLAUDE_PROJECTS_DIR, this.sessions);
    this.output.appendLine(
      `[sesh] scan complete: scanned=${result.scanned} upserted=${result.upserted} skipped=${result.skipped}`,
    );
  }

  async stop(): Promise<void> {
    if (this.scanPromise) {
      try {
        await this.scanPromise;
      } catch {
        // surfaced separately by start()
      }
    }
    if (this.db) {
      this.db.close();
      this.db = null;
      this.sessions = null;
    }
  }
}
