import { Virtuoso } from "react-virtuoso";
import type { SessionListItem } from "../messaging";
import type { Category } from "../hooks/useCategories";
import { Icon } from "./Icon";
import { Highlight } from "./Highlight";
import { SourceBadge } from "./SourceBadge";

interface Props {
  sessions: SessionListItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  categories: Category[];
  searchQuery: string;
}

function relativeTime(ms: number): string {
  if (!ms) return "";
  const diff = Date.now() - ms;
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d`;
  const mo = Math.floor(day / 30);
  if (mo < 12) return `${mo}mo`;
  return `${Math.floor(mo / 12)}y`;
}

function basename(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx >= 0 ? path.slice(idx + 1) : path;
}

export function SessionList({
  sessions,
  selectedId,
  onSelect,
  categories,
  searchQuery,
}: Props): JSX.Element {
  if (sessions.length === 0) {
    return (
      <div className="sesh-empty">
        <Icon name="inbox" />
        <p>No sessions in this view.</p>
      </div>
    );
  }
  const categoryById = new Map(categories.map((c) => [c.id, c]));
  return (
    <Virtuoso
      className="sesh-list"
      data={sessions}
      itemContent={(_, s) => {
        const cat =
          s.category_id != null ? categoryById.get(s.category_id) : undefined;
        return (
          <div
            className={`sesh-list-row ${selectedId === s.id ? "is-selected" : ""}`}
            onClick={() => onSelect(s.id)}
          >
            <div className="sesh-list-line-1">
              {s.favorited ? (
                <Icon name="star-full" className="sesh-list-star" />
              ) : null}
              <span className="sesh-list-title" title={s.title}>
                <Highlight text={s.title} query={searchQuery} />
              </span>
              <span
                className="sesh-list-time"
                title={new Date(s.last_active_at).toLocaleString()}
              >
                {relativeTime(s.last_active_at)}
              </span>
            </div>
            <div className="sesh-list-line-2">
              <span className="sesh-list-msg-project">
                <span className="sesh-list-msgcount">
                  <Icon name="comment-discussion" /> {s.message_count}
                </span>
                <span className="sesh-list-sep">·</span>
                <span className="sesh-list-project" title={s.project_path}>
                  {basename(s.project_path)}
                </span>
              </span>
              <span className="sesh-list-meta-chips">
                {cat && (
                  <span
                    className="sesh-cat-pill"
                    style={cat.color ? { background: cat.color } : undefined}
                  >
                    {cat.name}
                  </span>
                )}
                {s.tags.map((t) => (
                  <span key={t} className="sesh-tag">
                    #{t}
                  </span>
                ))}
                <SourceBadge source={s.source} className="sesh-list-source" />
              </span>
            </div>
          </div>
        );
      }}
    />
  );
}
