import { useState, useCallback, useEffect } from "react";
import { TabBar, type SeshTab } from "./components/TabBar";
import { SessionsTab } from "./components/SessionsTab";
import { InsightsTab } from "./components/InsightsTab";
import { KnowledgeTab } from "./components/KnowledgeTab";
import { IdeasTab } from "./components/IdeasTab";
import { ReviewerTab } from "./components/ReviewerTab";
import { SettingsTab } from "./components/SettingsTab";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { onHostMessage, postToHost } from "./messaging";

export interface AppSettings {
  tabs: { sessions: boolean; knowledge: boolean; ideas: boolean; insights: boolean; reviewer: boolean };
  pickUpBanner: boolean;
  pickUpScope: "global" | "workspace";
  statusBarShowCost: boolean;
  archiveTranscripts: boolean;
  outcomeInferenceDays: number;
  indexBackfillMode: "eager" | "lazy";
  transcriptLimit: number;
  gitIndexerEnabled: boolean;
  embeddingsEnabled: boolean;
  embeddingsAutoStart: boolean;
  ideaMining: boolean;
  ideaMiningSinceDays: number;
  embedder: "local" | "ollama" | "cloud";
  embedderModel: string;
  embedderApiKey: string;
  embedderApiUrl: string;
}

const DEFAULT_SETTINGS: AppSettings = {
  tabs: { sessions: true, knowledge: true, ideas: true, insights: true, reviewer: true },
  pickUpBanner: true,
  pickUpScope: "global",
  statusBarShowCost: true,
  archiveTranscripts: false,
  outcomeInferenceDays: 30,
  indexBackfillMode: "eager",
  transcriptLimit: 10000,
  gitIndexerEnabled: true,
  embeddingsEnabled: true,
  embeddingsAutoStart: false,
  ideaMining: true,
  ideaMiningSinceDays: 30,
  embedder: "local",
  embedderModel: "",
  embedderApiKey: "",
  embedderApiUrl: "",
};

function applyKey(prev: AppSettings, key: string, value: unknown): AppSettings {
  if (key.startsWith("tabs.")) {
    const sub = key.slice(5) as keyof AppSettings["tabs"];
    return { ...prev, tabs: { ...prev.tabs, [sub]: value as boolean } };
  }
  return { ...prev, [key as keyof AppSettings]: value as never };
}

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
    if (tab !== "sessions" && tab !== "settings" && !appSettings.tabs[tab]) {
      setTab("sessions");
    }
  }, [appSettings, tab]);

  const navigateToSession = useCallback((id: string) => {
    setSelectedSessionId(id);
    setTab("sessions");
  }, []);

  const updateSetting = useCallback((key: string, value: unknown) => {
    setAppSettings((prev) => applyKey(prev, key, value));
    postToHost({ kind: "setSetting", key, value });
  }, []);

  type MainTab = keyof typeof appSettings.tabs;
  const visibleTabs = new Set<SeshTab>(
    (Object.keys(appSettings.tabs) as MainTab[]).filter((t) => appSettings.tabs[t]),
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
        {tab === "settings" && <SettingsTab settings={appSettings} onUpdate={updateSetting} />}
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
    case "settings":
      return "Settings";
  }
}
