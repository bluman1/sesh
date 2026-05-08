import { useEffect, useState } from "react";
import {
  onHostMessage,
  postToHost,
  type Scope,
  type SessionListItem,
} from "../messaging";

export function useSessions(): {
  sessions: SessionListItem[];
  scope: Scope;
  setScope: (s: Scope) => void;
  currentPath: string | null;
  error: string | null;
} {
  const [sessions, setSessions] = useState<SessionListItem[]>([]);
  const [scope, setScope] = useState<Scope>("current");
  const [currentPath, setCurrentPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const dispose = onHostMessage((msg) => {
      if (msg.kind === "sessionList") {
        setSessions(msg.sessions);
        setError(null);
      } else if (msg.kind === "workspace") {
        setCurrentPath(msg.currentPath);
      } else if (msg.kind === "error") {
        setError(msg.message);
      }
    });
    postToHost({ kind: "ready" });
    return dispose;
  }, []);

  useEffect(() => {
    postToHost({ kind: "listSessions", scope, currentPath });
  }, [scope, currentPath]);

  return { sessions, scope, setScope, currentPath, error };
}
