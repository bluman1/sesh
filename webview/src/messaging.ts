export interface SessionListItem {
  id: string;
  title: string;
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
  source: string;
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

export type ToHost =
  | { kind: "ready" }
  | { kind: "listSessions"; scope: Scope; currentPath: string | null }
  | { kind: "getSession"; id: string }
  | { kind: "getTranscript"; id: string; limit: number }
  | { kind: "setCustomTitle"; id: string; title: string | null }
  | { kind: "setCategory"; id: string; categoryId: number | null }
  | { kind: "setNotes"; id: string; notes: string | null }
  | { kind: "setFavorited"; id: string; favorited: boolean }
  | { kind: "setArchived"; id: string; archived: boolean }
  | { kind: "setTags"; id: string; tags: string[] }
  | { kind: "createCategory"; name: string; color: string | null }
  | { kind: "renameCategory"; id: number; name: string }
  | { kind: "deleteCategory"; id: number }
  | { kind: "listCategories" }
  | { kind: "listAllTags" };

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
