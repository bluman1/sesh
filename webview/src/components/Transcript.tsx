import { Virtuoso } from "react-virtuoso";
import type { TranscriptMessage } from "../messaging";

interface Props {
  messages: TranscriptMessage[];
}

export function Transcript({ messages }: Props): JSX.Element {
  if (messages.length === 0) {
    return <div className="sesh-transcript-empty">No transcript content.</div>;
  }
  return (
    <Virtuoso
      className="sesh-transcript"
      data={messages}
      itemContent={(_, m) => (
        <div className={`sesh-msg sesh-msg-${m.type}`}>
          <div className="sesh-msg-role">{m.type}</div>
          <pre className="sesh-msg-text">{m.text}</pre>
        </div>
      )}
    />
  );
}
