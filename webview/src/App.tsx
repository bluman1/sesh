import { useState } from "react";
import { Toolbar } from "./components/Toolbar";
import { SessionList } from "./components/SessionList";
import { DetailPane } from "./components/DetailPane";
import { useSessions } from "./hooks/useSessions";
import { useSessionDetail } from "./hooks/useSessionDetail";
import { useCategories } from "./hooks/useCategories";

export function App(): JSX.Element {
  const { sessions, scope, setScope, error } = useSessions();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const detail = useSessionDetail(selectedId);
  const { categories } = useCategories();

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
            categories={categories}
          />
        </div>
        <div className="sesh-pane sesh-pane-detail">
          <DetailPane
            session={detail.session}
            transcript={detail.transcript}
            loading={detail.loading}
          />
        </div>
      </div>
    </div>
  );
}
