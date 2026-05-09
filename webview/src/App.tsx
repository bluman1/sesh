import { useState } from "react";
import { TabBar, type SeshTab } from "./components/TabBar";
import { SessionsTab } from "./components/SessionsTab";
import { InsightsTab } from "./components/InsightsTab";
import { PlaceholderTab } from "./components/PlaceholderTab";

export function App(): JSX.Element {
  const [tab, setTab] = useState<SeshTab>("sessions");
  return (
    <div className="sesh-root">
      <TabBar active={tab} onChange={setTab} />
      {tab === "sessions" && <SessionsTab />}
      {tab === "knowledge" && <PlaceholderTab name="Knowledge" />}
      {tab === "insights" && <InsightsTab />}
      {tab === "ideas" && <PlaceholderTab name="Ideas" />}
      {tab === "reviewer" && <PlaceholderTab name="Reviewer" />}
    </div>
  );
}
