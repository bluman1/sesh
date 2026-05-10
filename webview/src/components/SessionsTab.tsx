import { useState, useEffect } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { Toolbar } from "./Toolbar";
import { SessionList } from "./SessionList";
import { DetailPane } from "./DetailPane";
import { RemapBanner } from "./RemapBanner";
import { NextSessionBanner } from "./NextSessionBanner";
import { useSessions } from "../hooks/useSessions";
import { useSessionDetail } from "../hooks/useSessionDetail";
import { useCategories } from "../hooks/useCategories";
import { useAllTags } from "../hooks/useAllTags";
import { useProjects } from "../hooks/useProjects";
import { onHostMessage, postToHost, type ToWebview } from "../messaging";

type SearchResultItem = Extract<ToWebview, { kind: "searchResults" }>["results"][number];

type Props = {
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  pickUpBannerEnabled?: boolean;
  pickUpScope?: "global" | "workspace";
};

export function SessionsTab({ selectedId, onSelect, pickUpBannerEnabled = true, pickUpScope = "workspace" }: Props): JSX.Element {
  const sessionsApi = useSessions();
  const detail = useSessionDetail(selectedId);
  const { categories } = useCategories();
  const allTags = useAllTags();
  const projects = useProjects();

  // Semantic hits state — all hooks at top before any conditional return
  const [semanticHits, setSemanticHits] = useState<SearchResultItem[]>([]);

  useEffect(() => {
    const off = onHostMessage((msg) => {
      if (msg.kind === "searchResults") setSemanticHits(msg.results);
    });
    return off;
  }, []);

  useEffect(() => {
    const trimmed = sessionsApi.filters.query.trim();
    if (!trimmed) {
      setSemanticHits([]);
      return;
    }
    const t = setTimeout(() => postToHost({ kind: "semanticSearch", query: trimmed, limit: 10 }), 300);
    return () => clearTimeout(t);
  }, [sessionsApi.filters.query]);

  // Deduplicate semantic hits: remove any whose session_id is already in FTS results
  const ftsSessionIds = new Set(sessionsApi.sessions.map((s) => s.id));
  const filteredSemanticHits = semanticHits.filter((h) => !ftsSessionIds.has(h.session_id));
  const hasQuery = sessionsApi.filters.query.trim().length > 0;

  return (
    <>
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
      {pickUpBannerEnabled && <NextSessionBanner onNavigateToSession={onSelect} scope={pickUpScope} />}
      {sessionsApi.error && <div className="sesh-error">{sessionsApi.error}</div>}
      {sessionsApi.indexProgress.total > 0 &&
        sessionsApi.indexProgress.indexed < sessionsApi.indexProgress.total && (
          <div className="sesh-status">
            indexing {sessionsApi.indexProgress.indexed} of{" "}
            {sessionsApi.indexProgress.total} transcripts…
          </div>
        )}
      <div className="sesh-body">
        <PanelGroup direction="horizontal" autoSaveId="sesh-main-split" className="sesh-panel-group">
          <Panel defaultSize={32} minSize={20} maxSize={50} className="sesh-pane sesh-pane-list">
            <SessionList
              sessions={sessionsApi.sessions}
              selectedId={selectedId}
              onSelect={onSelect}
              categories={categories}
              searchQuery={sessionsApi.filters.query}
              emptyHint={
                sessionsApi.filters.scope === "current" && !sessionsApi.filters.currentPath
                  ? "No workspace folder is open. Pick a folder from the dropdown above, or switch to All projects."
                  : sessionsApi.filters.scope === "current"
                    ? "No sessions yet for this folder."
                    : undefined
              }
            />
            {hasQuery && filteredSemanticHits.length > 0 && (
              <SemanticHits hits={filteredSemanticHits} onSelect={onSelect} />
            )}
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
    </>
  );
}

function SemanticHits({
  hits,
  onSelect,
}: {
  hits: SearchResultItem[];
  onSelect: (id: string) => void;
}): JSX.Element {
  return (
    <div className="sesh-semantic-section">
      <div className="sesh-semantic-section-title">Semantically similar</div>
      {hits.map((h) => (
        <div
          key={h.chunk_id}
          className="sesh-semantic-row"
          onClick={() => onSelect(h.session_id)}
        >
          <div className="sesh-semantic-row-title">{h.session_title}</div>
          <div className="sesh-semantic-row-snippet">{h.snippet}</div>
        </div>
      ))}
    </div>
  );
}
