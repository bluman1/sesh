import * as vscode from "vscode";
import { ensureNativePrebuild } from "./native-prebuild";
import { SeshHost } from "./host/seshHost";
import { SeshPanel } from "./host/seshPanel";
import { SeshStatusBar } from "./host/statusBar";
import { TurnRepository } from "./db/turns";
import { ToolCallRepository } from "./db/toolCalls";
import { TurnsIndexer, runFullReindex } from "./scanner/turnsIndexer";
import { inferOutcomes } from "./scanner/outcomeInferer";
import { CommitRepository } from "./db/commits";
import { GitIndexer } from "./git/gitIndexer";
import { runFullGitReindex } from "./git/runFullGitReindex";
import { ChunkRepository } from "./db/chunks";
import { EmbeddingRepository } from "./db/embeddings";
import { createEmbedder } from "./embed/factory";
import type { Embedder, EmbedderConfig } from "./embed/types";
import { XenovaEmbedder, type XenovaProgressEvent } from "./embed/xenovaEmbedder";
import { EmbeddingIndexer } from "./scanner/embeddingIndexer";
import { IdeaIndexer } from "./scanner/ideaIndexer";
import { IdeaRepository } from "./db/ideas";
import { CorrectionMiner } from "./scanner/correctionMiner";
import { ClaudeMdSuggestionRepository } from "./db/claudeMd";
import { PromptLinter } from "./scanner/promptLinter";
import { PromptLintRepository } from "./db/promptLints";

let host: SeshHost | null = null;
let turnsIndexer: TurnsIndexer | null = null;
let gitIndexer: GitIndexer | null = null;
let embeddingIndexer: EmbeddingIndexer | null = null;
let embedder: Embedder | null = null;
let embedStatusItem: vscode.StatusBarItem | null = null;
// Serialize live setup/teardown so a fast double-toggle can't race.
let embeddingTransitions: Promise<void> = Promise.resolve();

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  ensureNativePrebuild(context.extensionPath);

  const isDev = context.extensionMode === vscode.ExtensionMode.Development;
  const output = vscode.window.createOutputChannel(isDev ? "Sesh (dev)" : "Sesh");
  context.subscriptions.push(output);
  if (isDev) {
    output.appendLine("[sesh] running in extension-development mode — using ~/.sesh/dev/ for DB");
  }

  host = new SeshHost(output, { dev: isDev });

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
    vscode.commands.registerCommand("sesh.reindexEmbeddings", async () => {
      if (!embeddingIndexer) {
        vscode.window.showInformationMessage("Embeddings are disabled.");
        return;
      }
      const runner = (embeddingIndexer as unknown as { runFullChain?: () => Promise<void> }).runFullChain;
      if (runner) {
        await runner();
      } else {
        await embeddingIndexer.run();
      }
      vscode.window.showInformationMessage("Sesh: embeddings reindexed.");
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("sesh.suggestClaudeMd", async () => {
      const miner = host?.currentCorrectionMiner;
      if (!miner) return;
      await miner.run();
      await vscode.commands.executeCommand("sesh.open");
      vscode.window.showInformationMessage("Sesh: CLAUDE.md suggestions refreshed. Open the Knowledge tab.");
    }),
    vscode.commands.registerCommand("sesh.exportStyleFingerprint", async () => {
      const { computeStyleFingerprint, exportFingerprintToFile } = await import("./scanner/styleFingerprint");
      const fp = computeStyleFingerprint(host!.rawDb!);
      const uri = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file("sesh-style-fingerprint.json"),
        filters: { "JSON": ["json"] },
      });
      if (!uri) return;
      exportFingerprintToFile(fp, uri.fsPath);
      vscode.window.showInformationMessage(`Saved fingerprint to ${uri.fsPath}`);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("sesh.reindexGit", async () => {
      if (!host || !gitIndexer) return;
      const windowDays = vscode.workspace
        .getConfiguration("sesh")
        .get<number>("outcomeInferenceDays", 30);
      await runFullGitReindex({
        db: host.rawDb!,
        sessions: host.sessions!,
        gitIndexer,
        windowDays,
      });
      vscode.window.showInformationMessage("Sesh: git reindexed.");
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

    setupEmbeddingChain(host, turnRepo, context);
    // Respect `embeddingsAutoStart` at activation only. Live toggles
    // (below) always run the chain — the user just opted in.
    if (cfg.get<boolean>("embeddingsAutoStart", false)) {
      void runEmbeddingChainIfPossible().catch((err) => {
        console.warn("[sesh] eager indexing failed", err);
      });
    }

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

    triggerGitReindexIfEnabled();

    // Live config-change handlers. Toggling embeddings, embedder config,
    // idea mining, or git indexing now applies immediately — no window
    // reload required. Setup/teardown is serialized through embeddingTransitions
    // so a fast double-toggle can't race two parallel chains.
    context.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (!e.affectsConfiguration("sesh")) return;
        const embeddingsTouched =
          e.affectsConfiguration("sesh.embeddingsEnabled") ||
          e.affectsConfiguration("sesh.embedder") ||
          e.affectsConfiguration("sesh.embedderModel") ||
          e.affectsConfiguration("sesh.embedderApiKey") ||
          e.affectsConfiguration("sesh.embedderApiUrl") ||
          e.affectsConfiguration("sesh.ideaMining");
        if (embeddingsTouched && host) {
          embeddingTransitions = embeddingTransitions
            .then(async () => {
              teardownEmbeddingChain(host!);
              setupEmbeddingChain(host!, turnRepo, context);
              await runEmbeddingChainIfPossible();
            })
            .catch((err) => {
              console.warn("[sesh] live embedding setup failed", err);
            });
        }
        if (e.affectsConfiguration("sesh.gitIndexerEnabled")) {
          triggerGitReindexIfEnabled();
        }
      }),
    );

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
  embeddingIndexer?.cancel();
  await host?.stop();
  host = null;
  turnsIndexer = null;
  gitIndexer = null;
  embeddingIndexer = null;
  embedder = null;
  embedStatusItem?.dispose();
  embedStatusItem = null;
}

/**
 * Construct + register the embedder, EmbeddingIndexer, IdeaIndexer (if
 * enabled), CorrectionMiner, and PromptLinter on the host. No-op when
 * `sesh.embeddingsEnabled` is false. Idempotent: callers should
 * teardownEmbeddingChain() first if anything may already be registered.
 */
function setupEmbeddingChain(
  h: SeshHost,
  turnRepo: TurnRepository,
  context: vscode.ExtensionContext,
): void {
  const cfg = vscode.workspace.getConfiguration("sesh");
  if (!cfg.get<boolean>("embeddingsEnabled", false)) return;

  const cfgKind = cfg.get<string>("embedder", "local");
  const model = cfg.get<string>("embedderModel", "");
  const apiKey = cfg.get<string>("embedderApiKey", "");
  const apiUrl = cfg.get<string>("embedderApiUrl", "");
  let embedderCfg: EmbedderConfig;
  if (cfgKind === "ollama") {
    embedderCfg = { kind: "ollama", url: apiUrl || undefined, model: model || undefined };
  } else if (cfgKind === "cloud") {
    embedderCfg = { kind: "cloud", url: apiUrl || undefined, apiKey, model: model || undefined };
  } else {
    embedderCfg = { kind: "local", model: model || undefined };
  }
  embedder = createEmbedder(embedderCfg);

  const chunkRepo = new ChunkRepository(h.rawDb!);
  const embeddingRepo = new EmbeddingRepository(h.rawDb!);
  embeddingIndexer = new EmbeddingIndexer(
    h.rawDb!,
    h.sessions!,
    turnRepo,
    chunkRepo,
    embeddingRepo,
    embedder,
  );
  h.setEmbeddingIndexer(embeddingIndexer);
  h.setEmbedder(embedder);

  // Reuse the existing status-bar item across re-setups so we don't leak
  // one per toggle.
  if (!embedStatusItem) {
    embedStatusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
    embedStatusItem.name = "Sesh: embeddings";
    context.subscriptions.push(embedStatusItem);
  }
  const status = embedStatusItem;
  embeddingIndexer.setProgressHandler((indexed, total) => {
    if (total === 0) { status.hide(); return; }
    if (indexed >= total) {
      status.text = `$(check) Sesh: embeddings up to date`;
      status.show();
      setTimeout(() => status.hide(), 4000);
      return;
    }
    status.text = `$(sync~spin) Sesh: indexing ${indexed}/${total}`;
    status.tooltip = "Sesh is embedding your sessions. The Knowledge and Style views will fill in once this finishes.";
    status.show();
  });

  if (cfg.get<boolean>("ideaMining", false)) {
    const ideaRepo = new IdeaRepository(h.rawDb!);
    const ideaIndexer = new IdeaIndexer(
      ideaRepo,
      chunkRepo,
      embedder,
      cfg.get<number>("ideaMiningSinceDays", 30),
    );
    h.setIdeaIndexer(ideaIndexer);
  }

  const claudeMdRepo = new ClaudeMdSuggestionRepository(h.rawDb!);
  const correctionMiner = new CorrectionMiner(h.rawDb!, chunkRepo, claudeMdRepo, embedder);
  h.setCorrectionMiner(correctionMiner);

  const lintRepo = new PromptLintRepository(h.rawDb!);
  const promptLinter = new PromptLinter(h.rawDb!, chunkRepo, embeddingRepo, lintRepo, embedder);
  h.setPromptLinter(promptLinter);

  // Stash the full-chain runner on the embedding indexer so the reindex
  // command and live config-change handler can call the FULL pipeline,
  // not just embedding.
  const localEmbedder = embedder;
  const localEmbeddingIndexer = embeddingIndexer;
  const ideaRef = h.currentIdeaIndexer;
  const runEmbeddingChain = async () => {
    if (cfgKind === "local" && localEmbedder) {
      await preloadLocalEmbedderWithProgress(localEmbedder);
    }
    await localEmbeddingIndexer.run();
    if (ideaRef) await ideaRef.run();
    await correctionMiner.run();
    await promptLinter.run();
  };
  (localEmbeddingIndexer as unknown as { runFullChain: () => Promise<void> }).runFullChain = runEmbeddingChain;
}

/** Cancel any in-flight embedding work and drop references on the host. */
function teardownEmbeddingChain(h: SeshHost): void {
  embeddingIndexer?.cancel();
  embeddingIndexer = null;
  embedder = null;
  h.setEmbeddingIndexer(null);
  h.setIdeaIndexer(null);
  h.setCorrectionMiner(null);
  h.setPromptLinter(null);
  h.setEmbedder(null);
  embedStatusItem?.hide();
}

/** Run the full chain if embeddings are enabled and a runner exists. */
async function runEmbeddingChainIfPossible(): Promise<void> {
  const idx = embeddingIndexer;
  if (!idx) return;
  const runner = (idx as unknown as { runFullChain?: () => Promise<void> }).runFullChain;
  if (runner) await runner();
}

/** Trigger a full git reindex if `gitIndexerEnabled` is on. Cheap when off. */
function triggerGitReindexIfEnabled(): void {
  if (!host || !gitIndexer) return;
  const cfg = vscode.workspace.getConfiguration("sesh");
  if (!cfg.get<boolean>("gitIndexerEnabled", false)) return;
  void runFullGitReindex({
    db: host.rawDb!,
    sessions: host.sessions!,
    gitIndexer,
    windowDays: cfg.get<number>("outcomeInferenceDays", 30),
  }).catch((err) => {
    console.warn("[sesh] git reindex failed", err);
  });
}

/**
 * Force the local Xenova embedder to download / load its model, with a
 * VS Code notification showing per-file download progress. Returns once
 * the pipeline is ready. Only runs the notification surface when the
 * embedder is actually a XenovaEmbedder; for other embedder kinds this
 * is a no-op.
 */
async function preloadLocalEmbedderWithProgress(e: Embedder): Promise<void> {
  if (!(e instanceof XenovaEmbedder)) return;
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Sesh: loading embedding model",
      cancellable: false,
    },
    async (progress) => {
      const fileTotals = new Map<string, number>();
      const fileLoaded = new Map<string, number>();
      let lastReportedPct = -1;
      const onEvent = (ev: XenovaProgressEvent) => {
        if (ev.status === "progress" && ev.file) {
          if (typeof ev.total === "number") fileTotals.set(ev.file, ev.total);
          if (typeof ev.loaded === "number") fileLoaded.set(ev.file, ev.loaded);
          let total = 0;
          let loaded = 0;
          for (const v of fileTotals.values()) total += v;
          for (const v of fileLoaded.values()) loaded += v;
          if (total > 0) {
            const pct = Math.min(99, Math.floor((loaded / total) * 100));
            if (pct !== lastReportedPct) {
              progress.report({ message: `${pct}% — ${ev.file}` });
              lastReportedPct = pct;
            }
          } else if (ev.file) {
            progress.report({ message: `downloading ${ev.file}` });
          }
        } else if (ev.status === "ready") {
          progress.report({ message: "ready" });
        }
      };
      const off = e.onProgress(onEvent);
      try {
        await e.preload();
      } finally {
        off();
      }
    },
  );
}
