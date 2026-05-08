import { Virtuoso } from "react-virtuoso";
import type { TranscriptMessage } from "../messaging";
import { Highlight } from "./Highlight";

interface Props {
  messages: TranscriptMessage[];
  searchQuery?: string;
}

export function Transcript({ messages, searchQuery = "" }: Props): JSX.Element {
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
          <pre className="sesh-msg-text">
            <Highlight text={m.text} query={searchQuery} />
          </pre>
        </div>
      )}
    />
  );
}
