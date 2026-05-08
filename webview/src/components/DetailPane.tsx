import type { SessionDetail, TranscriptMessage } from "../messaging";
import { Transcript } from "./Transcript";

interface Props {
  session: SessionDetail | null;
  transcript: TranscriptMessage[];
  loading: boolean;
}

function formatDate(ms: number): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleString();
}

export function DetailPane({ session, transcript, loading }: Props): JSX.Element {
  if (loading && !session) {
    return <div className="sesh-detail-empty">Loading…</div>;
  }
  if (!session) {
    return <div className="sesh-detail-empty">Select a session on the left.</div>;
  }
  return (
    <div className="sesh-detail">
      <div className="sesh-detail-head">
        <h2 className="sesh-detail-title">
          {session.favorited ? "★ " : ""}
          {session.title}
        </h2>
        <div className="sesh-detail-meta">
          {session.tags.length > 0 && (
            <div className="sesh-list-tags">
              {session.tags.map((t) => (
                <span key={t} className="sesh-tag">
                  {t}
                </span>
              ))}
            </div>
          )}
          <div className="sesh-detail-stats">
            <span>{session.message_count} messages</span>
            <span>·</span>
            <span>created {formatDate(session.created_at)}</span>
            <span>·</span>
            <span>last active {formatDate(session.last_active_at)}</span>
          </div>
          <div className="sesh-detail-path" title={session.file_path}>
            {session.project_path}
          </div>
        </div>
      </div>
      {session.notes && (
        <div className="sesh-detail-notes">
          <div className="sesh-detail-notes-label">Notes</div>
          <pre>{session.notes}</pre>
        </div>
      )}
      <div className="sesh-detail-transcript">
        <div className="sesh-detail-transcript-label">Transcript</div>
        <Transcript messages={transcript} />
      </div>
    </div>
  );
}
