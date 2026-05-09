import * as vscode from "vscode";
import type { SeshHost } from "./seshHost";
import {
  rowToDetail,
  rowToListItem,
  type SearchFilters,
  type ToHost,
  type ToWebview,
  type SessionAnalyticsChip,
} from "../messaging";
import { searchSessions, countSessionsInScope } from "../db/search";
import { readTranscript } from "../scanner/transcript";
import { readCodexTranscript } from "../scanner/codex/transcript";
import {
  buildExcerpt,
  generateTitle,
  TitleGenerationError,
} from "./titleGenerator";
import {
  costByFile,
  modelLeaderboard,
  personalRecords,
  todaysStandup,
  recentCommitments,
  usdForTurn,
} from "../db/analyticsQueries";
import { OutcomeRepository } from "../db/outcomes";
import type { TurnsIndexer } from "../scanner/turnsIndexer";
import type { Db } from "../db/connection";

function buildAnalyticsChip(db: Db, sessionId: string): SessionAnalyticsChip {
  const outcome = db
    .prepare("SELECT state FROM session_outcomes WHERE session_id = ?")
    .get(sessionId) as { state: SessionAnalyticsChip["outcome"] } | undefined;
  const cost = db
    .prepare(
      `SELECT model, SUM(tokens_in) AS ti, SUM(tokens_out) AS to_, SUM(tokens_cache_read) AS tcr, SUM(tokens_cache_create) AS tcc
       FROM turns WHERE session_id = ? GROUP BY model ORDER BY (SUM(tokens_in) + SUM(tokens_out)) DESC LIMIT 1`,
    )
    .get(sessionId) as
      | { model: string | null; ti: number; to_: number; tcr: number; tcc: number }
      | undefined;
  const usd = cost
    ? usdForTurn({
        model: cost.model,
        tokens_in: cost.ti,
        tokens_out: cost.to_,
        tokens_cache_read: cost.tcr,
        tokens_cache_create: cost.tcc,
      })
    : 0;
  return {
    outcome: outcome?.state ?? null,
    usd,
    primary_model: cost?.model ?? null,
  };
}

export class SeshPanel {
  private static instance: SeshPanel | null = null;

  static openOrFocus(context: vscode.ExtensionContext, host: SeshHost, turnsIndexer: TurnsIndexer): void {
    if (SeshPanel.instance) {
      SeshPanel.instance.panel.reveal(vscode.ViewColumn.Active);
      return;
    }
    SeshPanel.instance = new SeshPanel(context, host, turnsIndexer);
  }

  private readonly panel: vscode.WebviewPanel;
  private disposed = false;
  private lastFilters: SearchFilters | null = null;

  private constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly host: SeshHost,
    private readonly turnsIndexer: TurnsIndexer,
  ) {
    this.panel = vscode.window.createWebviewPanel(
      "seshMain",
      "Sesh",
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(context.extensionUri, "webview", "dist"),
        ],
      },
    );
    // VSCode does not auto-tint WebviewPanel.iconPath SVGs the way it does
    // activity-bar icons, so we ship explicit light + dark variants.
    this.panel.iconPath = {
      light: vscode.Uri.joinPath(
        context.extensionUri,
        "resources",
        "sesh-icon-light.svg",
      ),
      dark: vscode.Uri.joinPath(
        context.extensionUri,
        "resources",
        "sesh-icon-dark.svg",
      ),
    };

    this.panel.webview.html = this.buildHtml();
    this.panel.webview.onDidReceiveMessage(
      (msg: ToHost) => {
        void this.onMessage(msg);
      },
      null,
      context.subscriptions,
    );
    host.onIndexProgress = () => {
      this.send({
        kind: "indexProgress",
        indexed: host.indexProgress.indexed,
        total: host.indexProgress.total,
      });
    };
    host.onSessionChanged = () => {
      this.refreshList();
    };
    this.panel.onDidDispose(() => {
      this.disposed = true;
      SeshPanel.instance = null;
      host.onIndexProgress = undefined;
      host.onSessionChanged = undefined;
    });
  }

  private buildHtml(): string {
    const distRoot = vscode.Uri.joinPath(
      this.context.extensionUri,
      "webview",
      "dist",
    );
    const indexJs = this.panel.webview.asWebviewUri(
      vscode.Uri.joinPath(distRoot, "assets", "index.js"),
    );
    const indexCss = this.panel.webview.asWebviewUri(
      vscode.Uri.joinPath(distRoot, "assets", "index.css"),
    );
    const cspSource = this.panel.webview.cspSource;
    const nonce = String(Date.now()) + Math.random().toString(36).slice(2);
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${cspSource} data:; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; font-src ${cspSource};" />
  <title>Sesh</title>
  <link rel="stylesheet" href="${indexCss}" />
</head>
<body>
  <div id="root"></div>
  <script type="module" nonce="${nonce}" src="${indexJs}"></script>
</body>
</html>`;
  }

  private send(msg: ToWebview): void {
    if (this.disposed) return;
    this.panel.webview.postMessage(msg);
  }

  private async onMessage(msg: ToHost): Promise<void> {
    try {
      if (msg.kind === "ready") {
        const folders = vscode.workspace.workspaceFolders;
        const currentPath =
          folders && folders.length > 0 ? folders[0].uri.fsPath : null;
        this.send({ kind: "workspace", currentPath });
        return;
      }
      if (!this.host.sessions || !this.host.tags || !this.host.categories) {
        this.send({ kind: "error", message: "Sesh is still starting up." });
        return;
      }
      switch (msg.kind) {
        case "searchSessions": {
          this.lastFilters = msg.filters;
          const rows = searchSessions(this.host.rawDb!, msg.filters);
          const items = rows.map((row) =>
            rowToListItem(row, this.host.tags!.getTags(row.id), buildAnalyticsChip(this.host.rawDb!, row.id)),
          );
          this.send({
            kind: "sessionList",
            scope: msg.filters.scope,
            currentPath: msg.filters.currentPath,
            sessions: items,
            totalInScope: countSessionsInScope(this.host.rawDb!, msg.filters),
          });
          this.suggestRemaps();
          break;
        }
        case "getSession": {
          const row = this.host.sessions.findById(msg.id);
          if (!row) {
            this.send({ kind: "error", message: `Session not found: ${msg.id}` });
            return;
          }
          const detail = rowToDetail(row, this.host.tags.getTags(msg.id));
          this.send({ kind: "sessionDetail", session: detail });
          break;
        }
        case "getTranscript": {
          const row = this.host.sessions.findById(msg.id);
          if (!row) {
            this.send({ kind: "error", message: `Session not found: ${msg.id}` });
            return;
          }
          const limit = msg.limit ?? this.transcriptLimitFromSettings();
          // Pick a readable source: original JSONL, archive fallback, or empty.
          let sourcePath: string | null = null;
          if (row.orphaned === 0) {
            sourcePath = row.file_path;
          } else if (this.host.archive.has(row.id)) {
            sourcePath = this.host.archive.pathFor(row.id);
          }
          const reader =
            row.source === "codex" ? readCodexTranscript : readTranscript;
          const messages = sourcePath
            ? await reader(sourcePath, limit)
            : [];
          this.send({ kind: "transcript", id: msg.id, messages });
          break;
        }
        case "setCustomTitle":
          this.host.sessions.setCustomTitle(msg.id, msg.title);
          this.refreshDetail(msg.id);
          this.refreshList();
          break;
        case "setCategory":
          this.host.sessions.setCategory(msg.id, msg.categoryId);
          this.refreshDetail(msg.id);
          this.refreshList();
          break;
        case "setNotes":
          this.host.sessions.setNotes(msg.id, msg.notes);
          this.refreshDetail(msg.id);
          break;
        case "setFavorited":
          this.host.sessions.setFavorited(msg.id, msg.favorited);
          this.refreshDetail(msg.id);
          this.refreshList();
          break;
        case "setArchived":
          this.host.sessions.setArchived(msg.id, msg.archived);
          this.refreshDetail(msg.id);
          this.refreshList();
          break;
        case "resumeInTerminal": {
          const row = this.host.sessions.findById(msg.sessionId);
          if (!row) {
            this.send({ kind: "error", message: `Session not found: ${msg.sessionId}` });
            return;
          }
          const terminal = vscode.window.createTerminal({
            name: `Sesh: resume ${msg.sessionId.slice(0, 8)}`,
            cwd: row.project_path,
          });
          terminal.show(true);
          const cmd =
            row.source === "codex"
              ? `codex resume ${msg.sessionId}`
              : `claude --resume ${msg.sessionId}`;
          terminal.sendText(cmd, true);
          break;
        }
        case "openClaudeCodePanel": {
          // The Claude Code extension's `claude-vscode.editor.open` command accepts
          // (sessionId, initialPrompt, viewColumn) at runtime even though only the
          // command id is declared in its package.json. Passing sessionId resumes
          // that specific session in a new editor tab.
          try {
            await vscode.commands.executeCommand(
              "claude-vscode.editor.open",
              msg.sessionId,
            );
          } catch {
            this.send({
              kind: "error",
              message:
                "Claude Code VSCode extension not installed. Install it from the Marketplace, or use 'Resume in terminal' instead.",
            });
          }
          break;
        }
        case "addRemap": {
          this.host.sessions.addRemap(msg.fromPath, msg.toPath);
          this.refreshList();
          break;
        }
        case "listRemaps": {
          this.send({
            kind: "remapsList",
            remaps: this.host.sessions.listRemaps(),
          });
          break;
        }
        case "generateTitle": {
          await this.handleGenerateTitle(msg.id);
          break;
        }
        case "openFolderInNewWindow": {
          try {
            // Drop a short-lived marker in globalState (shared across all
            // VSCode windows) so the extension activating in the new window
            // can see "we just got opened from a Sesh row, please re-open
            // Sesh in this window" and call SeshPanel.openOrFocus on its
            // own. The 60s expiry means a stale marker won't surface a Sesh
            // panel in an unrelated window opened minutes later.
            await this.context.globalState.update("sesh.pendingOpenForPath", {
              path: msg.path,
              expiresAt: Date.now() + 60_000,
            });
            await vscode.commands.executeCommand(
              "vscode.openFolder",
              vscode.Uri.file(msg.path),
              true,
            );
          } catch (err) {
            this.send({
              kind: "error",
              message: `Failed to open folder: ${(err as Error).message}`,
            });
          }
          break;
        }
        case "setTags":
          this.host.tags!.setTags(msg.id, msg.tags);
          this.refreshDetail(msg.id);
          this.refreshList();
          this.broadcastAllTags();
          break;
        case "createCategory": {
          const cat = this.host.categories!.create({
            name: msg.name,
            color: msg.color,
            sort_order: 0,
          });
          this.broadcastCategories();
          if (msg.assignToSessionId) {
            this.host.sessions.setCategory(msg.assignToSessionId, cat.id);
            this.refreshDetail(msg.assignToSessionId);
            this.refreshList();
          }
          break;
        }
        case "renameCategory":
          this.host.categories!.rename(msg.id, msg.name);
          this.broadcastCategories();
          break;
        case "deleteCategory":
          this.host.categories!.delete(msg.id);
          this.broadcastCategories();
          this.refreshList();
          break;
        case "listCategories":
          this.broadcastCategories();
          break;
        case "listAllTags":
          this.broadcastAllTags();
          break;
        case "listProjects":
          this.broadcastProjects();
          break;
        case "getInsights": {
          const sinceMs = Date.now() - msg.sinceDays * 86400 * 1000;
          let payload: unknown;
          switch (msg.tab) {
            case "standup":
              payload = todaysStandup({ db: this.host.rawDb!, todayStart: sinceMs });
              break;
            case "cost":
              payload = costByFile({ db: this.host.rawDb!, since: sinceMs });
              break;
            case "leaderboard":
              payload = modelLeaderboard({ db: this.host.rawDb!, since: sinceMs });
              break;
            case "records":
              payload = personalRecords({ db: this.host.rawDb! });
              break;
          }
          this.send({ kind: "insights", tab: msg.tab, payload });
          break;
        }
        case "setOutcome": {
          const outcomes = new OutcomeRepository(this.host.rawDb!);
          outcomes.setUser(msg.sessionId, msg.state, msg.notes ?? null);
          // Re-broadcast the affected session so chips refresh
          this.refreshList();
          break;
        }
        case "triggerReindexAnalytics": {
          // Mark all sessions as needing re-index, then run
          this.host.rawDb!.prepare("UPDATE sessions SET turns_indexed = 0 WHERE orphaned = 0").run();
          this.turnsIndexer
            .run()
            .then(() => this.refreshList())
            .catch((err) => console.error("[sesh] reindex analytics failed", err));
          break;
        }
        case "getCommitments": {
          const sinceMs = Date.now() - msg.sinceDays * 86400 * 1000;
          const commitments = recentCommitments({ db: this.host.rawDb!, since: sinceMs });
          this.send({
            kind: "commitments",
            commitments: commitments.map((c) => ({
              session_id: c.session_id,
              ts: c.ts,
              excerpt: c.excerpt,
            })),
          });
          break;
        }
      }
    } catch (err) {
      this.send({
        kind: "error",
        message: `Sesh host error: ${(err as Error).message}`,
      });
    }
  }

  private async handleGenerateTitle(id: string): Promise<void> {
    if (!this.host.sessions) return;
    const row = this.host.sessions.findById(id);
    if (!row) {
      this.send({ kind: "error", message: `Session not found: ${id}` });
      return;
    }
    this.send({ kind: "titleGenerationProgress", id, state: "running" });
    try {
      const sourcePath =
        row.orphaned === 0
          ? row.file_path
          : this.host.archive.has(row.id)
            ? this.host.archive.pathFor(row.id)
            : null;
      if (!sourcePath) {
        throw new TitleGenerationError(
          "Transcript was pruned and no archive copy is available.",
        );
      }
      const reader =
        row.source === "codex" ? readCodexTranscript : readTranscript;
      // Ten messages is plenty for a 5–7 word title — buildExcerpt will trim
      // further to the first three with non-empty text/thinking blocks.
      const messages = await reader(sourcePath, 10);
      const excerpt = buildExcerpt(messages);
      const title = await generateTitle(row.source, excerpt);
      this.host.sessions.setCustomTitle(id, title);
      this.refreshDetail(id);
      this.refreshList();
      this.send({ kind: "titleGenerationProgress", id, state: "done" });
    } catch (err) {
      const message =
        err instanceof TitleGenerationError
          ? err.message
          : `Failed to generate title: ${(err as Error).message}`;
      this.send({
        kind: "titleGenerationProgress",
        id,
        state: "error",
        message,
      });
    }
  }

  private refreshDetail(id: string): void {
    if (!this.host.sessions || !this.host.tags) return;
    const row = this.host.sessions.findById(id);
    if (!row) return;
    this.send({
      kind: "sessionDetail",
      session: rowToDetail(row, this.host.tags.getTags(id)),
    });
  }

  private refreshList(): void {
    if (!this.host.sessions || !this.host.tags || !this.lastFilters) return;
    const rows = searchSessions(this.host.rawDb!, this.lastFilters);
    const items = rows.map((row) =>
      rowToListItem(row, this.host.tags!.getTags(row.id), buildAnalyticsChip(this.host.rawDb!, row.id)),
    );
    this.send({
      kind: "sessionList",
      scope: this.lastFilters.scope,
      currentPath: this.lastFilters.currentPath,
      sessions: items,
      totalInScope: countSessionsInScope(this.host.rawDb!, this.lastFilters),
    });
  }

  private broadcastCategories(): void {
    if (!this.host.categories) return;
    this.send({ kind: "categoriesList", categories: this.host.categories.listAll() });
  }

  private broadcastAllTags(): void {
    if (!this.host.tags) return;
    this.send({ kind: "allTags", tags: this.host.tags.listAllTags() });
  }

  private broadcastProjects(): void {
    if (!this.host.rawDb) return;
    const rows = this.host.rawDb
      .prepare(
        `SELECT project_path AS path, COUNT(*) AS sessionCount
         FROM sessions
         WHERE archived = 0
         GROUP BY project_path
         ORDER BY MAX(last_active_at) DESC`,
      )
      .all() as { path: string; sessionCount: number }[];
    this.send({ kind: "projectsList", projects: rows });
  }

  private transcriptLimitFromSettings(): number {
    const cfg = vscode.workspace.getConfiguration("sesh");
    const raw = cfg.get<number>("transcriptLimit", 10000);
    if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 1) {
      return 10000;
    }
    return Math.floor(raw);
  }

  private suggestRemaps(): void {
    if (!this.host.sessions || !this.lastFilters?.currentPath) return;
    const currentPath = this.lastFilters.currentPath;
    const basename = currentPath.split("/").pop() ?? "";
    if (!basename) return;
    const allRows = this.host.rawDb!
      .prepare(
        `SELECT project_path, COUNT(*) as cnt FROM sessions
         WHERE project_path != ? AND project_path NOT IN (SELECT from_path FROM project_remap)
         GROUP BY project_path`,
      )
      .all(currentPath) as { project_path: string; cnt: number }[];
    const candidates = allRows
      .filter((r) => {
        const b = r.project_path.split("/").pop() ?? "";
        return b === basename;
      })
      .map((r) => ({
        fromPath: r.project_path,
        basename,
        sessionCount: r.cnt,
      }));
    if (candidates.length > 0) {
      this.send({ kind: "remapSuggestion", candidates, currentPath });
    }
  }
}
