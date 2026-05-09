import { useState } from "react";
import { BranchView } from "./reviewer/BranchView";
import { SessionsView } from "./reviewer/SessionsView";
import { PRsView } from "./reviewer/PRsView";
import "./ReviewerTab.css";

type SubTab = "branch" | "sessions" | "prs";
const SUBS: { id: SubTab; label: string }[] = [
  { id: "branch", label: "Branch" },
  { id: "sessions", label: "Sessions" },
  { id: "prs", label: "PRs" },
];

type Props = { onNavigateToSession: (id: string) => void };

export function ReviewerTab({ onNavigateToSession }: Props): JSX.Element {
  const [sub, setSub] = useState<SubTab>("branch");
  return (
    <div className="sesh-reviewer">
      <nav className="sesh-reviewer-nav">
        {SUBS.map((s) => (
          <button
            key={s.id}
            className={`sesh-reviewer-tab${sub === s.id ? " is-active" : ""}`}
            onClick={() => setSub(s.id)}
          >
            {s.label}
          </button>
        ))}
      </nav>
      <div className="sesh-reviewer-body">
        {sub === "branch" && <BranchView onNavigateToSession={onNavigateToSession} />}
        {sub === "sessions" && <SessionsView onNavigateToSession={onNavigateToSession} />}
        {sub === "prs" && <PRsView />}
      </div>
    </div>
  );
}
