import * as vscode from "vscode";
import type { SeshHost } from "./seshHost";
import {
  rowToDetail,
  rowToListItem,
  type ToHost,
  type ToWebview,
} from "../messaging";
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

    this.panel.webview.html = this.buildHtml();
    this.panel.webview.onDidReceiveMessage(
      (msg: ToHost) => {
        void this.onMessage(msg);
      },
      null,
      context.subscriptions,
    );
    this.panel.onDidDispose(() => {
      this.disposed = true;
      SeshPanel.instance = null;
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
      if (!this.host.sessions || !this.host.tags) {
        this.send({ kind: "error", message: "Sesh is still starting up." });
        return;
      }
      switch (msg.kind) {
        case "listSessions": {
          const rows =
            msg.scope === "all" || !msg.currentPath
              ? this.host.sessions.listAllNonArchived()
              : this.host.sessions.listByProjectNonArchived(msg.currentPath);
          const items = rows.map((row) =>
            rowToListItem(row, this.host.tags!.getTags(row.id)),
          );
          this.send({
            kind: "sessionList",
            scope: msg.scope,
            currentPath: msg.currentPath,
            sessions: items,
          });
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
          const messages = await readTranscript(row.file_path, msg.limit);
          this.send({ kind: "transcript", id: msg.id, messages });
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
}
