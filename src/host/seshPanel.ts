import * as vscode from "vscode";
import type { SeshHost } from "./seshHost";
import {
  rowToDetail,
  rowToListItem,
  type SearchFilters,
  type ToHost,
  type ToWebview,
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
  buildAnalyticsChips,
  costByFile,
  modelLeaderboard,
  personalRecords,
  standupSummary,
  recentCommitments,
} from "../db/analyticsQueries";
import { OutcomeRepository } from "../db/outcomes";
import type { TurnsIndexer } from "../scanner/turnsIndexer";
import { runFullReindex } from "../scanner/turnsIndexer";
import { CommitRepository } from "../db/commits";
import { SessionCommitRepository } from "../db/sessionCommits";
import { findRepoRoot } from "../git/repoDiscovery";
import { runFullGitReindex } from "../git/runFullGitReindex";
import {
  isGhAvailable,
  listOpenPRsWithCommits,
  type PRWithCommits,
} from "../git/ghCompanion";
import {
  runListLocalBranches,
  runRemoteUrl,
  runCommitsInBranch,
} from "../git/runGit";
import { semanticSearch } from "../db/semanticQueries";
import { computeTopics } from "../db/topicsQuery";
import { computeGlossary } from "../db/glossaryQuery";
import { IdeaRepository } from "../db/ideas";
import { ClaudeMdSuggestionRepository } from "../db/claudeMd";
import { PromptLintRepository } from "../db/promptLints";
import { computeStyleFingerprint, exportFingerprintToFile } from "../scanner/styleFingerprint";
import { suggestNextSessionTopics } from "../scanner/nextSessionSuggester";

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
          const chips = buildAnalyticsChips(this.host.rawDb!, rows.map((r) => r.id));
          const items = rows.map((row) =>
            rowToListItem(row, this.host.tags!.getTags(row.id), chips.get(row.id)),
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
          if (row.turns_indexed === 0 && row.orphaned === 0) {
            try {
              await this.turnsIndexer.indexOne(row.id, row.file_path, row.source);
              this.refreshList();
            } catch (err) {
              console.warn("[sesh] lazy turn indexing failed", err);
            }
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
          let sinceMs: number;
          let priorRange: { start: number; end: number; label: string } | undefined;
          switch (msg.range) {
            case "today": {
              const today = new Date();
              today.setHours(0, 0, 0, 0);
              sinceMs = today.getTime();
              const yesterdayStart = sinceMs - 86400 * 1000;
              priorRange = { start: yesterdayStart, end: sinceMs, label: "yesterday" };
              break;
            }
            case "7d":
              sinceMs = Date.now() - 7 * 86400 * 1000;
              priorRange = {
                start: Date.now() - 14 * 86400 * 1000,
                end: sinceMs,
                label: "the previous 7 days",
              };
              break;
            case "30d":
              sinceMs = Date.now() - 30 * 86400 * 1000;
              priorRange = {
                start: Date.now() - 60 * 86400 * 1000,
                end: sinceMs,
                label: "the previous 30 days",
              };
              break;
            case "1y":
              sinceMs = Date.now() - 365 * 86400 * 1000;
              priorRange = {
                start: Date.now() - 730 * 86400 * 1000,
                end: sinceMs,
                label: "the previous year",
              };
              break;
            case "all":
              sinceMs = 0;
              priorRange = undefined;
              break;
          }
          let payload: unknown;
          switch (msg.tab) {
            case "standup":
              payload = standupSummary({
                db: this.host.rawDb!,
                since: sinceMs,
                priorRange,
              });
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
          const windowDays = vscode.workspace
            .getConfiguration("sesh")
            .get<number>("outcomeInferenceDays", 30);
          runFullReindex(this.host.rawDb!, this.turnsIndexer, windowDays)
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
        case "semanticSearch": {
          const e = this.host.currentEmbedder;
          if (!e) {
            this.send({ kind: "searchResults", query: msg.query, results: [] });
            break;
          }
          void (async () => {
            try {
              const hits = await semanticSearch(this.host.rawDb!, e, msg.query, { limit: msg.limit ?? 30 });
              this.send({
                kind: "searchResults",
                query: msg.query,
                results: hits.map((h) => ({
                  chunk_id: h.chunk.id,
                  session_id: h.session_id,
                  session_title: h.session_title,
                  session_project_path: h.session_project_path,
                  snippet: h.chunk.text.length > 240 ? h.chunk.text.slice(0, 240) + "…" : h.chunk.text,
                  score: h.score,
                })),
              });
            } catch (err) {
              console.warn("[sesh] semantic search failed", err);
              this.send({ kind: "searchResults", query: msg.query, results: [] });
            }
          })();
          break;
        }
        case "triggerReindexEmbeddings": {
          const idx = this.host.currentEmbeddingIndexer;
          if (!idx) break;
          void idx.run().catch((err) => console.warn("[sesh] embedding reindex failed", err));
          break;
        }
        case "getIdeas": {
          const repo = new IdeaRepository(this.host.rawDb!);
          const clusters = repo.listClusters();
          this.send({
            kind: "ideas",
            clusters: clusters.map((c) => ({
              cluster_id: c.cluster_id,
              size: c.size,
              ideas: c.ideas.map((i) => ({
                id: i.id,
                text: i.text,
                source_session_id: i.source_session_id,
                confidence: i.confidence,
                detected_at: i.detected_at,
                status: i.status,
              })),
            })),
          });
          break;
        }
        case "setIdeaStatus": {
          const repo = new IdeaRepository(this.host.rawDb!);
          repo.setStatus(msg.id, msg.status);
          // Re-send updated clusters.
          const clusters = repo.listClusters();
          this.send({
            kind: "ideas",
            clusters: clusters.map((c) => ({
              cluster_id: c.cluster_id,
              size: c.size,
              ideas: c.ideas.map((i) => ({
                id: i.id,
                text: i.text,
                source_session_id: i.source_session_id,
                confidence: i.confidence,
                detected_at: i.detected_at,
                status: i.status,
              })),
            })),
          });
          break;
        }
        case "getClaudeMdSuggestions": {
          const repo = new ClaudeMdSuggestionRepository(this.host.rawDb!);
          const open = repo.listOpen();
          this.send({
            kind: "claudeMdSuggestions",
            suggestions: open.map((s) => ({
              id: s.id,
              body: s.body,
              source_count: s.source_count,
              detected_at: s.detected_at,
              status: s.status,
            })),
          });
          break;
        }
        case "setClaudeMdStatus": {
          const repo = new ClaudeMdSuggestionRepository(this.host.rawDb!);
          repo.setStatus(msg.id, msg.status);
          const open = repo.listOpen();
          this.send({
            kind: "claudeMdSuggestions",
            suggestions: open.map((s) => ({
              id: s.id,
              body: s.body,
              source_count: s.source_count,
              detected_at: s.detected_at,
              status: s.status,
            })),
          });
          break;
        }
        case "getPromptLints": {
          const repo = new PromptLintRepository(this.host.rawDb!);
          const lints = repo.listForSession(msg.sessionId);
          this.send({
            kind: "promptLints",
            sessionId: msg.sessionId,
            lints: lints.map((l) => ({
              id: l.id,
              turn_id: l.turn_id,
              message: l.message,
              similar_session_ids: l.similar_session_ids,
            })),
          });
          break;
        }
        case "setPromptLintStatus": {
          const repo = new PromptLintRepository(this.host.rawDb!);
          repo.setStatus(msg.id, msg.status);
          break;
        }
        case "getStyleFingerprint": {
          const fp = computeStyleFingerprint(this.host.rawDb!, { sinceDays: msg.sinceDays });
          this.send({ kind: "styleFingerprint", fingerprint: fp });
          break;
        }
        case "exportStyleFingerprint": {
          void (async () => {
            const fp = computeStyleFingerprint(this.host.rawDb!);
            const uri = await vscode.window.showSaveDialog({
              defaultUri: vscode.Uri.file("sesh-style-fingerprint.json"),
              filters: { "JSON": ["json"] },
            });
            if (!uri) return;
            exportFingerprintToFile(fp, uri.fsPath);
            vscode.window.showInformationMessage(`Saved fingerprint to ${uri.fsPath}`);
          })();
          break;
        }
        case "getNextSessionSuggestions": {
          const items = suggestNextSessionTopics(this.host.rawDb!, { limit: 5 });
          this.send({ kind: "nextSessionSuggestions", suggestions: items });
          break;
        }
        case "dismissNextSessionSuggestion": {
          // For v1, dismissal is webview-local (cleared on reload). No persistence.
          break;
        }
        case "getTopics": {
          const e = this.host.currentEmbedder;
          if (!e) {
            this.send({ kind: "topics", topics: [] });
            break;
          }
          const t = computeTopics(this.host.rawDb!, e.modelName, { limit: msg.limit });
          this.send({ kind: "topics", topics: t });
          break;
        }
        case "getGlossary": {
          const g = computeGlossary(this.host.rawDb!, { limit: msg.limit });
          this.send({ kind: "glossary", entries: g });
          break;
        }
        case "getReviewerBranch": {
          void (async () => {
            const repoPath = msg.repoPath ?? this.resolveDefaultRepo();
            if (!repoPath) {
              this.send({
                kind: "reviewerBranch",
                repoPath: null,
                branch: null,
                branches: [],
                repoUrl: null,
                commits: [],
                offset: 0,
                hasMore: false,
              });
              return;
            }
            const commitRepo = new CommitRepository(this.host.rawDb!);
            const links = new SessionCommitRepository(this.host.rawDb!);
            const sessions = this.host.sessions!;

            const [branches, repoUrl] = await Promise.all([
              runListLocalBranches(repoPath),
              runRemoteUrl(repoPath),
            ]);

            // Determine which branch to display
            let selectedBranch: string | null = null;
            if (msg.branch && branches.includes(msg.branch)) {
              selectedBranch = msg.branch;
            } else if (branches.length > 0) {
              selectedBranch = branches[0];
            }

            // Load commits from DB (ordered by authored_at DESC), no hard cap
            let recent = commitRepo.listForRepo(repoPath);

            // Filter to commits reachable from the selected branch
            if (selectedBranch) {
              const inBranch = await runCommitsInBranch(repoPath, selectedBranch);
              recent = recent.filter((c) => inBranch.has(c.sha));
            }

            // Pagination
            const limit = msg.limit ?? 30;
            const offset = msg.offset ?? 0;
            const page = recent.slice(offset, offset + limit);
            const hasMore = recent.length > offset + page.length;

            // Batched lookups — 2 queries instead of N+1
            const shas = page.map((c) => c.sha);
            const sessionsByCommit = links.sessionsForCommits(shas);
            const allSessionIds = new Set<string>();
            for (const rows of sessionsByCommit.values()) {
              for (const r of rows) allSessionIds.add(r.session_id);
            }
            const sessionRowsById = sessions.findByIds([...allSessionIds]);

            const payload = page.map((c) => {
              const linked = sessionsByCommit.get(c.sha) ?? [];
              const enrichedSessions = linked.map((l) => {
                const row = sessionRowsById.get(l.session_id);
                return {
                  session_id: l.session_id,
                  title: row?.custom_title ?? row?.auto_title ?? "(untitled)",
                  confidence: l.confidence,
                };
              });
              return {
                sha: c.sha,
                message: c.message,
                author: c.author,
                authored_at: c.authored_at,
                sessions: enrichedSessions,
              };
            });

            this.send({
              kind: "reviewerBranch",
              repoPath,
              branch: selectedBranch,
              branches,
              repoUrl,
              commits: payload,
              offset,
              hasMore,
            });
          })();
          break;
        }
        case "getReviewerSessions": {
          const repoPath = msg.repoPath ?? this.resolveDefaultRepo();
          if (!repoPath) {
            this.send({ kind: "reviewerSessions", repoPath: null, sessions: [], offset: 0, hasMore: false });
            break;
          }
          const links = new SessionCommitRepository(this.host.rawDb!);
          const commitRepo = new CommitRepository(this.host.rawDb!);
          const sessions = this.host.sessions!;

          const repoSessions = sessions.listSessionsByRepo(repoPath);
          const sessionIds = repoSessions.map((s) => s.id);

          // Batched lookups — 2 queries instead of N+1
          const commitsBySession = links.commitsForSessions(sessionIds);
          const allCommitShas = new Set<string>();
          for (const rows of commitsBySession.values()) {
            for (const r of rows) allCommitShas.add(r.commit_sha);
          }
          const commitRowsBySha = commitRepo.findByShas([...allCommitShas]);

          // Build full filtered list BEFORE paginating so hasMore is accurate
          const filteredRepoSessions = repoSessions
            .map((s) => {
              const linked = commitsBySession.get(s.id);
              if (!linked || linked.length === 0) return null;
              return {
                session_id: s.id,
                title: s.custom_title ?? s.auto_title ?? "(untitled)",
                last_active_at: s.last_active_at,
                commits: linked.map((l) => {
                  const c = commitRowsBySha.get(l.commit_sha);
                  return {
                    sha: l.commit_sha,
                    message: c?.message ?? null,
                    confidence: l.confidence,
                  };
                }),
              };
            })
            .filter((x): x is NonNullable<typeof x> => x !== null);

          // Pagination
          const sessLimit = msg.limit ?? 30;
          const sessOffset = msg.offset ?? 0;
          const sessPage = filteredRepoSessions.slice(sessOffset, sessOffset + sessLimit);
          const sessHasMore = filteredRepoSessions.length > sessOffset + sessPage.length;

          this.send({ kind: "reviewerSessions", repoPath, sessions: sessPage, offset: sessOffset, hasMore: sessHasMore });
          break;
        }
        case "triggerReindexGit": {
          if (!this.host.currentGitIndexer || !this.host.sessions) break;
          const cfg = vscode.workspace.getConfiguration("sesh");
          const windowDays = cfg.get<number>("outcomeInferenceDays", 30);
          runFullGitReindex({
            db: this.host.rawDb!,
            sessions: this.host.sessions,
            gitIndexer: this.host.currentGitIndexer,
            windowDays,
          })
            .then(() => this.refreshList())
            .catch((err) => console.warn("[sesh] git reindex failed", err));
          break;
        }
        case "getReviewerPRs": {
          const repoPath = msg.repoPath ?? this.resolveDefaultRepo();
          if (!repoPath) {
            this.send({
              kind: "reviewerPRs",
              repoPath: null,
              ghAvailable: false,
              ghReason: "No git repo detected.",
              prs: [],
            });
            break;
          }
          void (async () => {
            const avail = await isGhAvailable();
            if (!avail.ok) {
              this.send({
                kind: "reviewerPRs",
                repoPath,
                ghAvailable: false,
                ghReason: avail.reason,
                prs: [],
              });
              return;
            }
            let prs: PRWithCommits[] = [];
            try {
              prs = await listOpenPRsWithCommits(repoPath);
            } catch (err) {
              console.warn("[sesh] gh pr list failed", err);
            }
            const links = new SessionCommitRepository(this.host.rawDb!);
            const enriched = prs.map((p) => ({
              number: p.number,
              title: p.title,
              head: p.head,
              url: p.url,
              commits: p.commit_shas.map((sha) => ({
                sha,
                sessions: links.sessionsForCommit(sha).map((l) => l.session_id),
              })),
            }));
            this.send({
              kind: "reviewerPRs",
              repoPath,
              ghAvailable: true,
              prs: enriched,
            });
          })();
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
    const chips = buildAnalyticsChips(this.host.rawDb!, rows.map((r) => r.id));
    const items = rows.map((row) =>
      rowToListItem(row, this.host.tags!.getTags(row.id), chips.get(row.id)),
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

  private resolveDefaultRepo(): string | null {
    const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!folder) return null;
    return findRepoRoot(folder);
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
