import * as vscode from "vscode";
import { SeshHost } from "./host/seshHost";
import { SeshPanel } from "./host/seshPanel";

let host: SeshHost | null = null;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const output = vscode.window.createOutputChannel("Sesh");
  context.subscriptions.push(output);

  host = new SeshHost(output);

  // Empty tree-data providers so the activity-bar view and secondary-sidebar
  // view both render their viewsWelcome content (a clickable 'Open Sesh
  // panel' button). Secondary sidebar is what shows up in the top-right
  // icon group alongside Claude Code and Codex; activity bar is the left
  // rail. Users can right-click any view to move it.
  const emptyTreeProvider: vscode.TreeDataProvider<unknown> = {
    getChildren: () => [],
    getTreeItem: () => new vscode.TreeItem(""),
  };
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("sesh.welcome", emptyTreeProvider),
    vscode.window.registerTreeDataProvider(
      "sesh.welcomeSecondary",
      emptyTreeProvider,
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("sesh.open", () => {
      if (!host) {
        vscode.window.showWarningMessage("Sesh is not running.");
        return;
      }
      SeshPanel.openOrFocus(context, host);
    }),
    vscode.commands.registerCommand("sesh.showStats", () => {
      if (!host?.sessions) {
        vscode.window.showWarningMessage("Sesh is still starting up.");
        return;
      }
      const total = host.sessions.countAll();
      vscode.window.showInformationMessage(`Sesh: ${total} sessions indexed.`);
    }),
    vscode.commands.registerCommand("sesh.rescan", async () => {
      if (!host) {
        vscode.window.showWarningMessage("Sesh is not running.");
        return;
      }
      await host.rescan();
      vscode.window.showInformationMessage("Sesh: rescan complete.");
    }),
    vscode.commands.registerCommand("sesh.archiveSize", async () => {
      if (!host) {
        vscode.window.showWarningMessage("Sesh is not running.");
        return;
      }
      const { files, bytes } = await host.archive.size();
      const enabled = vscode.workspace
        .getConfiguration("sesh")
        .get<boolean>("archiveTranscripts", false);
      const mb = (bytes / 1024 / 1024).toFixed(1);
      const status = enabled ? "enabled" : "disabled";
      vscode.window.showInformationMessage(
        files === 0
          ? `Sesh archive: empty (${status}).`
          : `Sesh archive: ${files} transcript${files === 1 ? "" : "s"}, ${mb} MB (${status}).`,
      );
    }),
  );

  try {
    await host.start();
    const cfg = vscode.workspace.getConfiguration("sesh");
    if (cfg.get<boolean>("openOnActivation", false)) {
      SeshPanel.openOrFocus(context, host);
    }
  } catch (err) {
    output.appendLine(`[sesh] activation error: ${(err as Error).message}`);
    vscode.window.showErrorMessage(`Sesh failed to start: ${(err as Error).message}`);
  }
}

export async function deactivate(): Promise<void> {
  await host?.stop();
  host = null;
}
