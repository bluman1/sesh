import * as vscode from "vscode";
import type { SeshHost } from "./seshHost";
import {
  rowToDetail,
  rowToListItem,
  type SearchFilters,
  type ToHost,
  type ToWebview,
} from "../messaging";
import { searchSessions } from "../db/search";
import { readTranscript } from "../scanner/transcript";

export class SeshPanel {
  private static instance: SeshPanel | null = null;

  static openOrFocus(context: vscode.ExtensionContext, host: SeshHost): void {
    if (SeshPanel.instance) {
      SeshPanel.instance.panel.reveal(vscode.ViewColumn.Active);
      return;
    }
    SeshPanel.instance = new SeshPanel(context, host);
  }

  private readonly panel: vscode.WebviewPanel;
  private disposed = false;
  private lastFilters: SearchFilters | null = null;

  private constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly host: SeshHost,
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
    this.panel.iconPath = vscode.Uri.joinPath(
      context.extensionUri,
      "resources",
      "sesh-icon.svg",
    );

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
            rowToListItem(row, this.host.tags!.getTags(row.id)),
          );
          this.send({
            kind: "sessionList",
            scope: msg.filters.scope,
            currentPath: msg.filters.currentPath,
            sessions: items,
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
          const messages = await readTranscript(row.file_path, limit);
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
          // Use the JSONL file's session id with claude --resume.
          terminal.sendText(`claude --resume ${msg.sessionId}`, true);
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
      }
    } catch (err) {
      this.send({
        kind: "error",
        message: `Sesh host error: ${(err as Error).message}`,
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
      rowToListItem(row, this.host.tags!.getTags(row.id)),
    );
    this.send({
      kind: "sessionList",
      scope: this.lastFilters.scope,
      currentPath: this.lastFilters.currentPath,
      sessions: items,
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
