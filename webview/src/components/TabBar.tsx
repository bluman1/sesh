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
  visibleTabs: Set<SeshTab>;
}

export function TabBar({ active, onChange, visibleTabs }: Props): JSX.Element {
  const tabs = TABS.filter((t) => visibleTabs.has(t.id));
  return (
    <div className="sesh-tabbar" role="tablist">
      {tabs.map((t) => (
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
