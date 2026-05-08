import type { Scope } from "../messaging";

interface Props {
  scope: Scope;
  onScopeChange: (s: Scope) => void;
  count: number;
  filtered: number;
}

export function Toolbar({ scope, onScopeChange, count, filtered }: Props): JSX.Element {
  return (
    <div className="sesh-toolbar">
      <div className="sesh-toolbar-row">
        <span className="sesh-title">Sesh</span>
        <select
          className="sesh-scope-select"
          value={scope}
          onChange={(e) => onScopeChange(e.target.value as Scope)}
        >
          <option value="current">Current folder</option>
          <option value="all">All projects</option>
        </select>
        <span className="sesh-count">
          {filtered === count
            ? `${count} sessions`
            : `${filtered} of ${count} sessions`}
        </span>
      </div>
    </div>
  );
}
