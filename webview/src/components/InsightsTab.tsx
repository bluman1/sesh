import { useState } from "react";
import { StandupView } from "./insights/StandupView";
import { CostView } from "./insights/CostView";
import { LeaderboardView } from "./insights/LeaderboardView";
import { RecordsView } from "./insights/RecordsView";
import { StyleView } from "./insights/StyleView";
import { type InsightsRange, RANGE_OPTIONS } from "./insights/range";
import "./InsightsTab.css";

type SubTab = "standup" | "cost" | "leaderboard" | "records" | "style";
const SUBS: { id: SubTab; label: string }[] = [
  { id: "standup", label: "Standup" },
  { id: "cost", label: "By file" },
  { id: "leaderboard", label: "Models" },
  { id: "records", label: "Records" },
  { id: "style", label: "Style" },
];

type Props = { onNavigateToSession?: (id: string) => void };

export function InsightsTab({ onNavigateToSession }: Props = {}): JSX.Element {
  const [sub, setSub] = useState<SubTab>("standup");
  const [range, setRange] = useState<InsightsRange>("today");

  return (
    <div className="sesh-insights">
      <nav className="sesh-insights-nav">
        <div className="sesh-insights-subs">
          {SUBS.map((s) => (
            <button
              key={s.id}
              className={`sesh-insights-tab${sub === s.id ? " is-active" : ""}`}
              onClick={() => setSub(s.id)}
            >
              {s.label}
            </button>
          ))}
        </div>
        {sub !== "records" && sub !== "style" && (
          <div className="sesh-insights-ranges">
            {RANGE_OPTIONS.map((r) => (
              <button
                key={r.id}
                className={`sesh-insights-range${range === r.id ? " is-active" : ""}`}
                onClick={() => setRange(r.id)}
              >
                {r.label}
              </button>
            ))}
          </div>
        )}
      </nav>
      <div className="sesh-insights-body">
        {sub === "standup" && <StandupView range={range} />}
        {sub === "cost" && <CostView range={range} onNavigateToSession={onNavigateToSession} />}
        {sub === "leaderboard" && <LeaderboardView range={range} />}
        {sub === "records" && <RecordsView />}
        {sub === "style" && <StyleView />}
      </div>
    </div>
  );
}
