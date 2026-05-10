import { useState, useCallback, useEffect } from "react";
import { TabBar, type SeshTab } from "./components/TabBar";
import { SessionsTab } from "./components/SessionsTab";
import { InsightsTab } from "./components/InsightsTab";
import { KnowledgeTab } from "./components/KnowledgeTab";
import { IdeasTab } from "./components/IdeasTab";
import { ReviewerTab } from "./components/ReviewerTab";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { onHostMessage } from "./messaging";

interface AppSettings {
  tabs: { sessions: boolean; knowledge: boolean; ideas: boolean; insights: boolean; reviewer: boolean };
  pickUpBanner: boolean;
  pickUpScope: "global" | "workspace";
}

const DEFAULT_SETTINGS: AppSettings = {
  tabs: { sessions: true, knowledge: true, ideas: true, insights: true, reviewer: true },
  pickUpBanner: true,
  pickUpScope: "global",
};

export function App(): JSX.Element {
  const [tab, setTab] = useState<SeshTab>("sessions");
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [appSettings, setAppSettings] = useState<AppSettings>(DEFAULT_SETTINGS);

  useEffect(() => {
    const off = onHostMessage((msg) => {
      if (msg.kind === "appSettings") {
        setAppSettings(msg.settings);
      }
    });
    return off;
  }, []);

  // If the active tab gets disabled, fall back to "sessions".
  useEffect(() => {
    if (tab !== "sessions" && !appSettings.tabs[tab]) {
      setTab("sessions");
    }
  }, [appSettings, tab]);

  const navigateToSession = useCallback((id: string) => {
    setSelectedSessionId(id);
    setTab("sessions");
  }, []);

  const visibleTabs = new Set<SeshTab>(
    (Object.keys(appSettings.tabs) as SeshTab[]).filter((t) => appSettings.tabs[t]),
  );

  return (
    <div className="sesh-root">
      <TabBar active={tab} onChange={setTab} visibleTabs={visibleTabs} />
      <ErrorBoundary key={tab} surface={tabSurfaceName(tab)}>
        {tab === "sessions" && (
          <SessionsTab
            selectedId={selectedSessionId}
            onSelect={setSelectedSessionId}
            pickUpBannerEnabled={appSettings.pickUpBanner}
          />
        )}
        {tab === "knowledge" && appSettings.tabs.knowledge && <KnowledgeTab onNavigateToSession={navigateToSession} />}
        {tab === "insights" && appSettings.tabs.insights && <InsightsTab />}
        {tab === "ideas" && appSettings.tabs.ideas && <IdeasTab onNavigateToSession={navigateToSession} />}
        {tab === "reviewer" && appSettings.tabs.reviewer && <ReviewerTab onNavigateToSession={navigateToSession} />}
      </ErrorBoundary>
    </div>
  );
}

function tabSurfaceName(tab: SeshTab): string {
  switch (tab) {
    case "sessions":
      return "Sessions";
    case "knowledge":
      return "Knowledge";
    case "insights":
      return "Insights";
    case "ideas":
      return "Ideas";
    case "reviewer":
      return "Reviewer";
  }
}
