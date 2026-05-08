import type { Scope, SearchFilters } from "../messaging";
import type { Category } from "../hooks/useCategories";
import { Icon } from "./Icon";

interface Props {
  filters: SearchFilters;
  onScopeChange: (s: Scope) => void;
  onQueryChange: (q: string) => void;
  onToggleArchived: () => void;
  onToggleFavorited: () => void;
  onToggleCategory: (id: number) => void;
  onToggleTag: (t: string) => void;
  count: number;
  filtered: number;
  categories: Category[];
  allTags: string[];
}

export function Toolbar(props: Props): JSX.Element {
  const {
    filters,
    onScopeChange,
    onQueryChange,
    onToggleArchived,
    onToggleFavorited,
    onToggleCategory,
    onToggleTag,
    count,
    filtered,
    categories,
    allTags,
  } = props;

  return (
    <div className="sesh-toolbar">
      <div className="sesh-toolbar-row">
        <div className="sesh-search-wrap">
          <Icon name="search" className="sesh-search-icon" />
          <input
            className="sesh-search-input"
            type="search"
            placeholder="Search annotations + transcripts…"
            value={filters.query}
            onChange={(e) => onQueryChange(e.target.value)}
          />
        </div>
        <select
          className="sesh-scope-select"
          value={filters.scope}
          onChange={(e) => onScopeChange(e.target.value as Scope)}
        >
          <option value="current">Current folder</option>
          <option value="all">All projects</option>
        </select>
        <span className="sesh-count">
          {filtered === count ? `${count} sessions` : `${filtered} of ${count}`}
        </span>
      </div>
      <div className="sesh-toolbar-row sesh-toolbar-chips">
        <button
          className={`sesh-chip ${filters.favorited === true ? "is-on" : ""}`}
          onClick={onToggleFavorited}
        >
          <Icon name="star-full" /> Favorited
        </button>
        <button
          className={`sesh-chip ${filters.archived === null ? "is-on" : ""}`}
          onClick={onToggleArchived}
          title={
            filters.archived === false ? "Hide archived" : "Show archived too"
          }
        >
          <Icon name="archive" />{" "}
          {filters.archived === null ? "Including archived" : "Active only"}
        </button>
        {categories.map((c) => (
          <button
            key={c.id}
            className={`sesh-chip ${filters.category_ids.includes(c.id) ? "is-on" : ""}`}
            onClick={() => onToggleCategory(c.id)}
            style={
              filters.category_ids.includes(c.id) && c.color
                ? { background: c.color }
                : undefined
            }
          >
            {c.name}
          </button>
        ))}
        {allTags.slice(0, 12).map((t) => (
          <button
            key={t}
            className={`sesh-chip sesh-chip-tag ${filters.tags.includes(t) ? "is-on" : ""}`}
            onClick={() => onToggleTag(t)}
          >
            #{t}
          </button>
        ))}
      </div>
    </div>
  );
}
