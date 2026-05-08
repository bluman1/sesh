import { Virtuoso } from "react-virtuoso";
import type { SessionListItem } from "../messaging";

interface Props {
  sessions: SessionListItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

function relativeTime(ms: number): string {
  if (!ms) return "";
  const diff = Date.now() - ms;
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  const mo = Math.floor(day / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(mo / 12)}y ago`;
}

export function SessionList({ sessions, selectedId, onSelect }: Props): JSX.Element {
  if (sessions.length === 0) {
    return <div className="sesh-empty">No sessions in this view.</div>;
  }
  return (
    <Virtuoso
      className="sesh-list"
      data={sessions}
      itemContent={(_, s) => (
        <div
          className={`sesh-list-row ${selectedId === s.id ? "is-selected" : ""}`}
          onClick={() => onSelect(s.id)}
        >
          <span className="sesh-list-star">{s.favorited ? "★" : ""}</span>
          <span className="sesh-list-title">{s.title}</span>
          <span className="sesh-list-meta">
            {s.message_count} msg · {relativeTime(s.last_active_at)}
          </span>
          {s.tags.length > 0 && (
            <div className="sesh-list-tags">
              {s.tags.map((t) => (
                <span key={t} className="sesh-tag">
                  {t}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    />
  );
}
