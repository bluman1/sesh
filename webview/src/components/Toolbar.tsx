import type { Scope, SearchFilters, ProjectFolder } from "../messaging";
import type { Category } from "../hooks/useCategories";
import { Icon } from "./Icon";

interface Props {
  filters: SearchFilters;
  onScopeChange: (s: Scope) => void;
  onSelectFolder: (path: string) => void;
  onQueryChange: (q: string) => void;
  onToggleArchived: () => void;
  onToggleFavorited: () => void;
  onToggleCategory: (id: number) => void;
  onToggleTag: (t: string) => void;
  count: number;
  filtered: number;
  categories: Category[];
  allTags: string[];
  projects: ProjectFolder[];
}

const SCOPE_VALUE_CURRENT = "__current__";
const SCOPE_VALUE_ALL = "__all__";

function basename(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx >= 0 ? path.slice(idx + 1) : path;
}

export function Toolbar(props: Props): JSX.Element {
  const {
    filters,
    onScopeChange,
    onSelectFolder,
    onQueryChange,
    onToggleArchived,
    onToggleFavorited,
    onToggleCategory,
    onToggleTag,
    count,
    filtered,
    categories,
    allTags,
    projects,
  } = props;

  const selectValue =
    filters.scope === "current"
      ? SCOPE_VALUE_CURRENT
      : filters.scope === "all"
        ? SCOPE_VALUE_ALL
        : filters.selectedFolderPath ?? SCOPE_VALUE_ALL;

  const handleScopeChange = (raw: string) => {
    if (raw === SCOPE_VALUE_CURRENT) {
      onScopeChange("current");
    } else if (raw === SCOPE_VALUE_ALL) {
      onScopeChange("all");
    } else {
      onSelectFolder(raw);
    }
  };

  const currentDisabled = !filters.currentPath;

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
          value={selectValue}
          onChange={(e) => handleScopeChange(e.target.value)}
          title={
            filters.scope === "current" && filters.currentPath
              ? `Showing sessions started in ${filters.currentPath}`
              : undefined
          }
        >
          <option value={SCOPE_VALUE_CURRENT} disabled={currentDisabled}>
            {currentDisabled
              ? "Current folder (no workspace)"
              : `Current folder · ${basename(filters.currentPath ?? "")}`}
          </option>
          <option value={SCOPE_VALUE_ALL}>All projects</option>
          {projects.length > 0 && (
            <optgroup label="Pick a folder">
              {projects.map((p) => (
                <option key={p.path} value={p.path}>
                  {basename(p.path)} ({p.sessionCount})
                </option>
              ))}
            </optgroup>
          )}
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
