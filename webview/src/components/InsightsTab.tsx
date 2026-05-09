import { useState } from "react";
import { StandupView } from "./insights/StandupView";
import { CostView } from "./insights/CostView";
import { LeaderboardView } from "./insights/LeaderboardView";
import { RecordsView } from "./insights/RecordsView";
import "./InsightsTab.css";

type SubTab = "standup" | "cost" | "leaderboard" | "records";
const SUBS: { id: SubTab; label: string }[] = [
  { id: "standup", label: "Today" },
  { id: "cost", label: "By file" },
  { id: "leaderboard", label: "Models" },
  { id: "records", label: "Records" },
];

export function InsightsTab(): JSX.Element {
  const [sub, setSub] = useState<SubTab>("standup");
  return (
    <div className="sesh-insights">
      <nav className="sesh-insights-nav">
        {SUBS.map((s) => (
          <button
            key={s.id}
            className={`sesh-insights-tab${sub === s.id ? " is-active" : ""}`}
            onClick={() => setSub(s.id)}
          >
            {s.label}
          </button>
        ))}
      </nav>
      <div className="sesh-insights-body">
        {sub === "standup" && <StandupView />}
        {sub === "cost" && <CostView />}
        {sub === "leaderboard" && <LeaderboardView />}
        {sub === "records" && <RecordsView />}
      </div>
    </div>
  );
}
