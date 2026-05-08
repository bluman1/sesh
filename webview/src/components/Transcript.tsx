import { useRef } from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import type { TranscriptMessage } from "../messaging";
import { Highlight } from "./Highlight";
import { Icon } from "./Icon";

interface Props {
  messages: TranscriptMessage[];
  searchQuery?: string;
}

const JUMP_THRESHOLD = 5;

export function Transcript({ messages, searchQuery = "" }: Props): JSX.Element {
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  if (messages.length === 0) {
    return <div className="sesh-transcript-empty">No transcript content.</div>;
  }
  const showControls = messages.length > JUMP_THRESHOLD;

  return (
    <div className="sesh-transcript-wrap">
      {showControls && (
        <div className="sesh-transcript-controls">
          <button
            className="sesh-text-btn"
            title="Jump to first message"
            onClick={() =>
              virtuosoRef.current?.scrollToIndex({ index: 0, align: "start" })
            }
          >
            <Icon name="arrow-up" /> Top
          </button>
          <button
            className="sesh-text-btn"
            title="Jump to latest message"
            onClick={() =>
              virtuosoRef.current?.scrollToIndex({
                index: messages.length - 1,
                align: "end",
              })
            }
          >
            <Icon name="arrow-down" /> Latest
          </button>
          <span className="sesh-transcript-count">
            {messages.length} messages
          </span>
        </div>
      )}
      <Virtuoso
        ref={virtuosoRef}
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
    </div>
  );
}
