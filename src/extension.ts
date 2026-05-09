import * as vscode from "vscode";
import { SeshHost } from "./host/seshHost";
import { SeshPanel } from "./host/seshPanel";
import { SeshStatusBar } from "./host/statusBar";
import { TurnRepository } from "./db/turns";
import { ToolCallRepository } from "./db/toolCalls";
import { TurnsIndexer, runFullReindex } from "./scanner/turnsIndexer";
import { inferOutcomes } from "./scanner/outcomeInferer";
import { CommitRepository } from "./db/commits";
import { GitIndexer } from "./git/gitIndexer";

let host: SeshHost | null = null;
let turnsIndexer: TurnsIndexer | null = null;
let gitIndexer: GitIndexer | null = null;

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
      if (!host || !turnsIndexer) {
        vscode.window.showWarningMessage("Sesh is not running.");
        return;
      }
      SeshPanel.openOrFocus(context, host, turnsIndexer);
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

  context.subscriptions.push(
    vscode.commands.registerCommand("sesh.reindexAnalytics", async () => {
      if (!host || !turnsIndexer) return;
      const windowDays = vscode.workspace
        .getConfiguration("sesh")
        .get<number>("outcomeInferenceDays", 30);
      await runFullReindex(host.rawDb!, turnsIndexer, windowDays);
      vscode.window.showInformationMessage("Sesh: analytics reindexed.");
    }),
  );

  try {
    await host.start();
    // Construct analytics repos and indexer now that rawDb is available.
    const turnRepo = new TurnRepository(host.rawDb!);
    const toolCallRepo = new ToolCallRepository(host.rawDb!);
    turnsIndexer = new TurnsIndexer(host.rawDb!, host.sessions!, turnRepo, toolCallRepo);
    host.setTurnsIndexer(turnsIndexer);
    const commitRepo = new CommitRepository(host.rawDb!);
    gitIndexer = new GitIndexer(host.rawDb!, host.sessions!, commitRepo);
    host.setGitIndexer(gitIndexer);
    const cfg = vscode.workspace.getConfiguration("sesh");
    const shouldOpenFromMarker = consumePendingOpenMarker(context, output);
    if (shouldOpenFromMarker || cfg.get<boolean>("openOnActivation", false)) {
      SeshPanel.openOrFocus(context, host, turnsIndexer);
    }

    const backfillMode = cfg.get<string>("indexBackfillMode", "eager");
    if (backfillMode === "eager") {
      // Fire and forget. Errors fall through to lazy mode (run on first view).
      turnsIndexer
        .run()
        .then(() => {
          const windowDays = cfg.get<number>("outcomeInferenceDays", 30);
          inferOutcomes({ db: host!.rawDb!, now: Date.now(), windowDays });
        })
        .catch((err) => {
          console.warn("[sesh] eager analytics backfill failed; will run lazily", err);
        });
    }

    // Run outcome inference daily so long-lived VSCode sessions age sessions
    // out to 'abandoned' without requiring a restart or manual reindex.
    const dailyInferenceTimer = setInterval(() => {
      if (!host?.rawDb) return;
      const windowDays = vscode.workspace
        .getConfiguration("sesh")
        .get<number>("outcomeInferenceDays", 30);
      inferOutcomes({ db: host.rawDb, now: Date.now(), windowDays });
    }, 24 * 60 * 60 * 1000);
    context.subscriptions.push({ dispose: () => clearInterval(dailyInferenceTimer) });

    const statusBar = new SeshStatusBar(host.rawDb!);
    statusBar.start();
    context.subscriptions.push({ dispose: () => statusBar.dispose() });
  } catch (err) {
    output.appendLine(`[sesh] activation error: ${(err as Error).message}`);
    vscode.window.showErrorMessage(`Sesh failed to start: ${(err as Error).message}`);
  }
}

interface PendingOpenMarker {
  path: string;
  expiresAt: number;
}

// True if the user just clicked a folder row in a Sesh panel of another
// VSCode window, the new window opened to that folder, and the marker is
// still fresh + matches our current workspace. Any other case clears the
// marker as housekeeping and returns false.
function consumePendingOpenMarker(
  context: vscode.ExtensionContext,
  output: vscode.OutputChannel,
): boolean {
  const marker = context.globalState.get<PendingOpenMarker>(
    "sesh.pendingOpenForPath",
  );
  if (!marker) return false;
  // Always clear once consumed/inspected — markers are one-shot.
  void context.globalState.update("sesh.pendingOpenForPath", undefined);
  if (Date.now() > marker.expiresAt) {
    return false;
  }
  const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!folder || folder !== marker.path) {
    return false;
  }
  output.appendLine(
    `[sesh] auto-opening panel — followed folder click from another window`,
  );
  return true;
}

export async function deactivate(): Promise<void> {
  await host?.stop();
  host = null;
  turnsIndexer = null;
  gitIndexer = null;
}
