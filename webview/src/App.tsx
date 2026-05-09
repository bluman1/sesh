import { useState } from "react";
import { TabBar, type SeshTab } from "./components/TabBar";
import { SessionsTab } from "./components/SessionsTab";
import { InsightsTab } from "./components/InsightsTab";
import { PlaceholderTab } from "./components/PlaceholderTab";
import { ErrorBoundary } from "./components/ErrorBoundary";

export function App(): JSX.Element {
  const [tab, setTab] = useState<SeshTab>("sessions");
  return (
    <div className="sesh-root">
      <TabBar active={tab} onChange={setTab} />
      <ErrorBoundary key={tab} surface={tabSurfaceName(tab)}>
        {tab === "sessions" && <SessionsTab />}
        {tab === "knowledge" && <PlaceholderTab name="Knowledge" />}
        {tab === "insights" && <InsightsTab />}
        {tab === "ideas" && <PlaceholderTab name="Ideas" />}
        {tab === "reviewer" && <PlaceholderTab name="Reviewer" />}
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
