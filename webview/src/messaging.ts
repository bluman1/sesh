export interface SessionAnalyticsChip {
  outcome: "open" | "shipped" | "shipped-partial" | "reverted" | "abandoned" | null;
  usd: number;
  primary_model: string | null;
}

export interface SessionListItem {
  id: string;
  title: string;
  source: string;
  project_path: string;
  last_active_at: number;
  created_at: number;
  message_count: number;
  favorited: 0 | 1;
  archived: 0 | 1;
  orphaned: 0 | 1;
  category_id: number | null;
  tags: string[];
  analytics?: SessionAnalyticsChip;
}

export interface SessionDetail extends SessionListItem {
  custom_title: string | null;
  auto_title: string | null;
  notes: string | null;
  file_path: string;
  tokens_in: number;
  tokens_out: number;
  tokens_cache_read: number;
  tokens_cache_create: number;
}

export type TranscriptBlock =
  | { kind: "text"; text: string }
  | { kind: "thinking"; text: string }
  | { kind: "tool_use"; id: string; name: string; input: unknown }
  | {
      kind: "tool_result";
      toolUseId: string;
      content: string;
      isError: boolean;
    }
  | { kind: "image"; mediaType: string; data: string };

export interface TranscriptMessage {
  type: "user" | "assistant";
  blocks: TranscriptBlock[];
  timestamp: number;
}

export type Scope = "current" | "all" | "folder";

export interface SearchFilters {
  scope: Scope;
  currentPath: string | null;
  selectedFolderPath: string | null;
  query: string;
  category_ids: number[];
  tags: string[];
  favorited: boolean | null;
  archived: boolean | null;
}

export interface ProjectFolder {
  path: string;
  sessionCount: number;
}

export type ToHost =
  | { kind: "ready" }
  | { kind: "searchSessions"; filters: SearchFilters }
  | { kind: "getSession"; id: string }
  | { kind: "getTranscript"; id: string; limit?: number }
  | { kind: "setCustomTitle"; id: string; title: string | null }
  | { kind: "setCategory"; id: string; categoryId: number | null }
  | { kind: "setNotes"; id: string; notes: string | null }
  | { kind: "setFavorited"; id: string; favorited: boolean }
  | { kind: "setArchived"; id: string; archived: boolean }
  | { kind: "setTags"; id: string; tags: string[] }
  | { kind: "createCategory"; name: string; color: string | null; assignToSessionId?: string }
  | { kind: "renameCategory"; id: number; name: string }
  | { kind: "deleteCategory"; id: number }
  | { kind: "listCategories" }
  | { kind: "listAllTags" }
  | { kind: "listProjects" }
  | { kind: "resumeInTerminal"; sessionId: string }
  | { kind: "openClaudeCodePanel"; sessionId?: string }
  | { kind: "addRemap"; fromPath: string; toPath: string }
  | { kind: "listRemaps" }
  | { kind: "generateTitle"; id: string }
  | { kind: "openFolderInNewWindow"; path: string }
  | { kind: "getInsights"; tab: "standup" | "cost" | "leaderboard" | "records"; range: "today" | "7d" | "30d" | "1y" | "all" }
  | { kind: "setOutcome"; sessionId: string; state: "open" | "shipped" | "shipped-partial" | "reverted" | "abandoned"; notes?: string | null }
  | { kind: "triggerReindexAnalytics" }
  | { kind: "getCommitments"; sinceDays: number }
  | { kind: "getReviewerBranch"; repoPath?: string; branch?: string; limit?: number; offset?: number }
  | { kind: "getReviewerSessions"; repoPath?: string; limit?: number; offset?: number }
  | { kind: "getReviewerPRs"; repoPath?: string }
  | { kind: "triggerReindexGit" }
  | { kind: "semanticSearch"; query: string; limit?: number }
  | { kind: "triggerReindexEmbeddings" }
  | { kind: "getIdeas" }
  | { kind: "setIdeaStatus"; id: string; status: "open" | "dismissed" | "done" | "scheduled" }
  | { kind: "getClaudeMdSuggestions" }
  | { kind: "setClaudeMdStatus"; id: string; status: "open" | "accepted" | "dismissed" }
  | { kind: "getPromptLints"; sessionId: string }
  | { kind: "setPromptLintStatus"; id: string; status: "open" | "dismissed" }
  | { kind: "getStyleFingerprint"; sinceDays?: number }
  | { kind: "exportStyleFingerprint" }
  | { kind: "getNextSessionSuggestions" }
  | { kind: "dismissNextSessionSuggestion"; key: string };

export type ToWebview =
  | { kind: "workspace"; currentPath: string | null }
  | {
      kind: "sessionList";
      scope: Scope;
      currentPath: string | null;
      sessions: SessionListItem[];
      totalInScope: number;
    }
  | { kind: "sessionDetail"; session: SessionDetail }
  | { kind: "transcript"; id: string; messages: TranscriptMessage[] }
  | { kind: "categoriesList"; categories: { id: number; name: string; color: string | null; sort_order: number }[] }
  | { kind: "allTags"; tags: string[] }
  | { kind: "indexProgress"; indexed: number; total: number }
  | {
      kind: "remapSuggestion";
      candidates: { fromPath: string; basename: string; sessionCount: number }[];
      currentPath: string | null;
    }
  | { kind: "remapsList"; remaps: { from_path: string; to_path: string }[] }
  | { kind: "projectsList"; projects: ProjectFolder[] }
  | {
      kind: "titleGenerationProgress";
      id: string;
      state: "running" | "done" | "error";
      message?: string;
    }
  | { kind: "error"; message: string }
  | { kind: "insights"; tab: "standup" | "cost" | "leaderboard" | "records"; payload: unknown }
  | { kind: "commitments"; commitments: { session_id: string; ts: number; excerpt: string }[] }
  | { kind: "analyticsProgress"; indexed: number; total: number }
  | {
      kind: "reviewerBranch";
      repoPath: string | null;
      branch: string | null;
      branches: string[];
      repoUrl: string | null;
      commits: {
        sha: string;
        message: string | null;
        author: string | null;
        authored_at: number;
        sessions: { session_id: string; title: string; confidence: number }[];
      }[];
      offset: number;
      hasMore: boolean;
    }
  | {
      kind: "reviewerSessions";
      repoPath: string | null;
      sessions: {
        session_id: string;
        title: string;
        last_active_at: number;
        commits: { sha: string; message: string | null; confidence: number }[];
      }[];
      offset: number;
      hasMore: boolean;
    }
  | {
      kind: "reviewerPRs";
      repoPath: string | null;
      ghAvailable: boolean;
      ghReason?: string;
      prs: {
        number: number;
        title: string;
        head: string;
        url: string;
        commits: { sha: string; sessions: string[] }[];
      }[];
    }
  | {
      kind: "searchResults";
      query: string;
      results: Array<{
        chunk_id: string;
        session_id: string;
        session_title: string;
        session_project_path: string;
        snippet: string;
        score: number;
      }>;
    }
  | {
      kind: "ideas";
      clusters: Array<{
        cluster_id: string;
        size: number;
        ideas: Array<{
          id: string;
          text: string;
          source_session_id: string;
          confidence: number;
          detected_at: number;
          status: "open" | "dismissed" | "done" | "scheduled";
        }>;
      }>;
    }
  | {
      kind: "claudeMdSuggestions";
      suggestions: Array<{
        id: string;
        body: string;
        source_count: number;
        detected_at: number;
        status: "open" | "accepted" | "dismissed";
      }>;
    }
  | {
      kind: "promptLints";
      sessionId: string;
      lints: Array<{
        id: string;
        turn_id: string;
        message: string;
        similar_session_ids: string[];
      }>;
    }
  | {
      kind: "styleFingerprint";
      fingerprint: {
        generated_at: number;
        source_session_count: number;
        source_chunk_count: number;
        total_chars: number;
        avg_user_chars_per_turn: number;
        avg_words_per_sentence: number;
        hedging_per_1000_words: number;
        exclamation_per_1000_chars: number;
        capital_letter_rate: number;
        top_tokens: { token: string; tfidf: number }[];
      };
    }
  | {
      kind: "nextSessionSuggestions";
      suggestions: Array<{
        kind: "idea" | "commitment";
        text: string;
        weight: number;
        source_session_ids: string[];
      }>;
    };

declare global {
  interface Window {
    acquireVsCodeApi?: () => {
      postMessage: (msg: ToHost) => void;
      getState: () => unknown;
      setState: (state: unknown) => void;
    };
  }
}

const vscode = window.acquireVsCodeApi?.();

export function postToHost(msg: ToHost): void {
  vscode?.postMessage(msg);
}

export function onHostMessage(handler: (msg: ToWebview) => void): () => void {
  const listener = (event: MessageEvent<ToWebview>) => handler(event.data);
  window.addEventListener("message", listener);
  return () => window.removeEventListener("message", listener);
}
