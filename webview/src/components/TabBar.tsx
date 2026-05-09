import "./TabBar.css";

export type SeshTab = "sessions" | "knowledge" | "insights" | "ideas" | "reviewer";

const TABS: { id: SeshTab; label: string }[] = [
  { id: "sessions", label: "Sessions" },
  { id: "knowledge", label: "Knowledge" },
  { id: "insights", label: "Insights" },
  { id: "ideas", label: "Ideas" },
  { id: "reviewer", label: "Reviewer" },
];

interface Props {
  active: SeshTab;
  onChange: (tab: SeshTab) => void;
}

export function TabBar({ active, onChange }: Props): JSX.Element {
  return (
    <div className="sesh-tabbar" role="tablist">
      {TABS.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={active === t.id}
          className={`sesh-tab${active === t.id ? " is-active" : ""}`}
          onClick={() => onChange(t.id)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
