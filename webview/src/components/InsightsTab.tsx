import { useState } from "react";
import { StandupView } from "./insights/StandupView";
import { CostView } from "./insights/CostView";
import { LeaderboardView } from "./insights/LeaderboardView";
import { RecordsView } from "./insights/RecordsView";
import { StyleView } from "./insights/StyleView";
import { TrendsView } from "./insights/TrendsView";
import { type InsightsRange, RANGE_OPTIONS, localStartOfDayMs, localEndOfDayMs } from "./insights/range";
import "./InsightsTab.css";

type SubTab = "standup" | "cost" | "leaderboard" | "records" | "style" | "trends";
const SUBS: { id: SubTab; label: string }[] = [
  { id: "standup", label: "Standup" },
  { id: "cost", label: "By file" },
  { id: "leaderboard", label: "Models" },
  { id: "records", label: "Records" },
  { id: "style", label: "Style" },
  { id: "trends", label: "Trends" },
];

type Props = { onNavigateToSession?: (id: string) => void };

export function InsightsTab({ onNavigateToSession }: Props = {}): JSX.Element {
  const [sub, setSub] = useState<SubTab>("standup");
  const [range, setRange] = useState<InsightsRange>("today");
  const [showCustomPanel, setShowCustomPanel] = useState(false);
  const [customStartStr, setCustomStartStr] = useState("");
  const [customEndStr, setCustomEndStr] = useState("");
  const [custom, setCustom] = useState<{ start: number; end: number } | null>(null);

  const handlePresetClick = (id: InsightsRange) => {
    setRange(id);
    setShowCustomPanel(false);
    setCustom(null);
  };

  const handleCustomChipClick = () => {
    setShowCustomPanel((prev) => !prev);
    if (range !== "custom") {
      setRange("custom");
      setCustom(null);
    }
  };

  const handleCustomStartChange = (val: string) => {
    setCustomStartStr(val);
    if (val && customEndStr) {
      setCustom({ start: localStartOfDayMs(val), end: localEndOfDayMs(customEndStr) });
      setRange("custom");
    }
  };

  const handleCustomEndChange = (val: string) => {
    setCustomEndStr(val);
    if (customStartStr && val) {
      setCustom({ start: localStartOfDayMs(customStartStr), end: localEndOfDayMs(val) });
      setRange("custom");
    }
  };

  const showRanges = sub !== "records" && sub !== "style" && sub !== "trends";

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
        {showRanges && (
          <div className="sesh-insights-ranges">
            {RANGE_OPTIONS.map((r) => (
              <button
                key={r.id}
                className={`sesh-insights-range${range === r.id ? " is-active" : ""}`}
                onClick={() => handlePresetClick(r.id)}
              >
                {r.label}
              </button>
            ))}
            <button
              className={`sesh-insights-range${range === "custom" ? " is-active" : ""}`}
              onClick={handleCustomChipClick}
            >
              Custom…
            </button>
          </div>
        )}
        {showRanges && showCustomPanel && (
          <div className="sesh-insights-custom-panel">
            <input
              type="date"
              className="sesh-insights-date-input"
              value={customStartStr}
              onChange={(e) => handleCustomStartChange(e.target.value)}
            />
            <span className="sesh-insights-date-sep">–</span>
            <input
              type="date"
              className="sesh-insights-date-input"
              value={customEndStr}
              onChange={(e) => handleCustomEndChange(e.target.value)}
            />
          </div>
        )}
      </nav>
      <div className="sesh-insights-body">
        {sub === "standup" && <StandupView range={range} custom={custom} />}
        {sub === "cost" && <CostView range={range} custom={custom} onNavigateToSession={onNavigateToSession} />}
        {sub === "leaderboard" && <LeaderboardView range={range} custom={custom} />}
        {sub === "records" && <RecordsView />}
        {sub === "style" && <StyleView />}
        {sub === "trends" && <TrendsView />}
      </div>
    </div>
  );
}
