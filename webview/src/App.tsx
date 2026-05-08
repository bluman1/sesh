import { useState } from "react";
import { Toolbar } from "./components/Toolbar";
import { SessionList } from "./components/SessionList";
import { DetailPane } from "./components/DetailPane";
import { useSessions } from "./hooks/useSessions";
import { useSessionDetail } from "./hooks/useSessionDetail";
import { useCategories } from "./hooks/useCategories";
import { useAllTags } from "./hooks/useAllTags";

export function App(): JSX.Element {
  const sessionsApi = useSessions();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const detail = useSessionDetail(selectedId);
  const { categories } = useCategories();
  const allTags = useAllTags();

  return (
    <div className="sesh-root">
      <Toolbar
        filters={sessionsApi.filters}
        onScopeChange={sessionsApi.setScope}
        onQueryChange={sessionsApi.setQuery}
        onToggleArchived={sessionsApi.toggleArchived}
        onToggleFavorited={sessionsApi.toggleFavorited}
        onToggleCategory={sessionsApi.toggleCategory}
        onToggleTag={sessionsApi.toggleTag}
        count={sessionsApi.sessions.length}
        filtered={sessionsApi.sessions.length}
        categories={categories}
        allTags={allTags}
      />
      {sessionsApi.error && <div className="sesh-error">{sessionsApi.error}</div>}
      {sessionsApi.indexProgress.total > 0 &&
        sessionsApi.indexProgress.indexed < sessionsApi.indexProgress.total && (
          <div className="sesh-status">
            indexing {sessionsApi.indexProgress.indexed} of{" "}
            {sessionsApi.indexProgress.total} transcripts…
          </div>
        )}
      <div className="sesh-body">
        <div className="sesh-pane sesh-pane-list">
          <SessionList
            sessions={sessionsApi.sessions}
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
