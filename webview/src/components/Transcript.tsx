import { useRef } from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import type { TranscriptMessage } from "../messaging";
import { Icon } from "./Icon";
import { MessageBlock } from "./MessageBlocks";

interface Props {
  messages: TranscriptMessage[];
  searchQuery?: string;
}

const JUMP_THRESHOLD = 5;

function formatAbsolute(ms: number): string {
  if (!ms) return "";
  return new Date(ms).toLocaleString();
}

function formatRelative(ms: number): string {
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
            <div className="sesh-msg-header">
              <span className="sesh-msg-role">{m.type}</span>
              {m.timestamp > 0 && (
                <span
                  className="sesh-msg-time sesh-tt"
                  data-tooltip={formatAbsolute(m.timestamp)}
                >
                  {formatRelative(m.timestamp)}
                </span>
              )}
            </div>
            <div className="sesh-msg-blocks">
              {m.blocks.map((block, i) => (
                <MessageBlock key={i} block={block} searchQuery={searchQuery} />
              ))}
            </div>
          </div>
        )}
      />
    </div>
  );
}
