import { useState } from "react";
import { Toolbar } from "./components/Toolbar";
import { SessionList } from "./components/SessionList";
import { useSessions } from "./hooks/useSessions";

export function App(): JSX.Element {
  const { sessions, scope, setScope, error } = useSessions();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  return (
    <div className="sesh-root">
      <Toolbar
        scope={scope}
        onScopeChange={setScope}
        count={sessions.length}
        filtered={sessions.length}
      />
      {error && <div className="sesh-error">{error}</div>}
      <div className="sesh-body">
        <div className="sesh-pane sesh-pane-list">
          <SessionList
            sessions={sessions}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
        </div>
        <div className="sesh-pane sesh-pane-detail">
          {selectedId ? (
            <div className="sesh-detail-placeholder">
              Selected: {selectedId} (detail pane in next task)
            </div>
          ) : (
            <div className="sesh-detail-empty">Select a session.</div>
          )}
        </div>
      </div>
    </div>
  );
}
