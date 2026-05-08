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
  category_id: number | null;
  tags: string[];
}

export interface SessionDetail extends SessionListItem {
  custom_title: string | null;
  auto_title: string | null;
  notes: string | null;
  file_path: string;
}

export interface TranscriptMessage {
  type: "user" | "assistant";
  text: string;
  timestamp: number;
}

export type Scope = "current" | "all";

export interface SearchFilters {
  scope: Scope;
  currentPath: string | null;
  query: string;
  category_ids: number[];
  tags: string[];
  favorited: boolean | null;
  archived: boolean | null;
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
  | { kind: "resumeInTerminal"; sessionId: string }
  | { kind: "openClaudeCodePanel"; sessionId?: string }
  | { kind: "addRemap"; fromPath: string; toPath: string }
  | { kind: "listRemaps" };

export type ToWebview =
  | { kind: "workspace"; currentPath: string | null }
  | {
      kind: "sessionList";
      scope: Scope;
      currentPath: string | null;
      sessions: SessionListItem[];
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
  | { kind: "error"; message: string };

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
  if (vscode) vscode.postMessage(msg);
  else console.log("[sesh] (no host)", msg);
}

export function onHostMessage(handler: (msg: ToWebview) => void): () => void {
  const listener = (event: MessageEvent<ToWebview>) => handler(event.data);
  window.addEventListener("message", listener);
  return () => window.removeEventListener("message", listener);
}
