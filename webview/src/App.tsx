import { useState } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { Toolbar } from "./components/Toolbar";
import { SessionList } from "./components/SessionList";
import { DetailPane } from "./components/DetailPane";
import { RemapBanner } from "./components/RemapBanner";
import { useSessions } from "./hooks/useSessions";
import { useSessionDetail } from "./hooks/useSessionDetail";
import { useCategories } from "./hooks/useCategories";
import { useAllTags } from "./hooks/useAllTags";
import { useProjects } from "./hooks/useProjects";

export function App(): JSX.Element {
  const sessionsApi = useSessions();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const detail = useSessionDetail(selectedId);
  const { categories } = useCategories();
  const allTags = useAllTags();
  const projects = useProjects();

  return (
    <div className="sesh-root">
      <Toolbar
        filters={sessionsApi.filters}
        onScopeChange={sessionsApi.setScope}
        onSelectFolder={sessionsApi.selectFolder}
        onQueryChange={sessionsApi.setQuery}
        onToggleArchived={sessionsApi.toggleArchived}
        onToggleFavorited={sessionsApi.toggleFavorited}
        onToggleCategory={sessionsApi.toggleCategory}
        onToggleTag={sessionsApi.toggleTag}
        count={sessionsApi.totalInScope}
        filtered={sessionsApi.sessions.length}
        categories={categories}
        allTags={allTags}
        projects={projects}
      />
      <RemapBanner />
      {sessionsApi.error && <div className="sesh-error">{sessionsApi.error}</div>}
      {sessionsApi.indexProgress.total > 0 &&
        sessionsApi.indexProgress.indexed < sessionsApi.indexProgress.total && (
          <div className="sesh-status">
            indexing {sessionsApi.indexProgress.indexed} of{" "}
            {sessionsApi.indexProgress.total} transcripts…
          </div>
        )}
      <div className="sesh-body">
        <PanelGroup
          direction="horizontal"
          autoSaveId="sesh-main-split"
          className="sesh-panel-group"
        >
          <Panel
            defaultSize={32}
            minSize={20}
            maxSize={50}
            className="sesh-pane sesh-pane-list"
          >
            <SessionList
              sessions={sessionsApi.sessions}
              selectedId={selectedId}
              onSelect={setSelectedId}
              categories={categories}
              searchQuery={sessionsApi.filters.query}
              emptyHint={
                sessionsApi.filters.scope === "current" &&
                !sessionsApi.filters.currentPath
                  ? "No workspace folder is open. Pick a folder from the dropdown above, or switch to All projects."
                  : sessionsApi.filters.scope === "current"
                    ? "No sessions yet for this folder."
                    : undefined
              }
            />
          </Panel>
          <PanelResizeHandle className="sesh-resize-handle" />
          <Panel className="sesh-pane sesh-pane-detail" minSize={40}>
            <DetailPane
              session={detail.session}
              transcript={detail.transcript}
              loading={detail.loading}
              currentPath={sessionsApi.currentPath}
              searchQuery={sessionsApi.filters.query}
            />
          </Panel>
        </PanelGroup>
      </div>
    </div>
  );
}
