import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { TranscriptBlock } from "../messaging";
import { Highlight } from "./Highlight";
import { Icon } from "./Icon";

interface BlockProps {
  block: TranscriptBlock;
  searchQuery: string;
}

export function MessageBlock({ block, searchQuery }: BlockProps): JSX.Element {
  switch (block.kind) {
    case "text":
      return <TextBlock text={block.text} query={searchQuery} />;
    case "thinking":
      return <ThinkingBlock text={block.text} query={searchQuery} />;
    case "tool_use":
      return (
        <ToolUseBlock id={block.id} name={block.name} input={block.input} />
      );
    case "tool_result":
      return (
        <ToolResultBlock
          content={block.content}
          isError={block.isError}
          query={searchQuery}
        />
      );
  }
}

/* ─── Text (markdown) ─────────────────────────────────────── */

function TextBlock({ text, query }: { text: string; query: string }): JSX.Element {
  // When a search is active we forgo markdown rendering on this block so
  // matched terms can be wrapped in <mark>. The cost is small — most text
  // blocks are short; a search session is the unusual case.
  if (query.trim()) {
    return (
      <pre className="sesh-block-text sesh-block-text-plain">
        <Highlight text={text} query={query} />
      </pre>
    );
  }
  return (
    <div className="sesh-block-text">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
    </div>
  );
}

/* ─── Thinking (collapsed) ────────────────────────────────── */

function ThinkingBlock({
  text,
  query,
}: {
  text: string;
  query?: string;
}): JSX.Element {
  const open =
    !!query?.trim() &&
    text.toLowerCase().includes(query.trim().toLowerCase());
  return (
    <details open={open} className="sesh-block-thinking">
      <summary>
        <Icon name="chevron-right" className="sesh-tool-chevron" />
        <Icon name="lightbulb" /> Thinking
      </summary>
      <div className="sesh-block-thinking-body">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
      </div>
    </details>
  );
}

/* ─── Tool use ────────────────────────────────────────────── */

interface ToolUseProps {
  id: string;
  name: string;
  input: unknown;
}

function ToolUseBlock({ name, input }: ToolUseProps): JSX.Element {
  const formatted = formatToolInput(name, input);
  const hasBody = Boolean(formatted.body);
  return (
    <details className="sesh-block-tool sesh-block-tool-use">
      <summary className="sesh-tool-header">
        <Icon name="chevron-right" className="sesh-tool-chevron" />
        <Icon name="play" />
        <span className="sesh-tool-name">{name}</span>
        {formatted.summary && (
          <span className="sesh-tool-summary" title={formatted.summary}>
            {formatted.summary}
          </span>
        )}
        {!hasBody && <span className="sesh-tool-empty">no input</span>}
      </summary>
      {hasBody && <pre className="sesh-tool-body">{formatted.body}</pre>}
    </details>
  );
}

interface FormattedTool {
  summary?: string;
  body?: string;
}

function formatToolInput(name: string, input: unknown): FormattedTool {
  if (!input || typeof input !== "object") {
    return { body: String(input ?? "") };
  }
  const i = input as Record<string, unknown>;
  switch (name) {
    case "Bash": {
      const desc = typeof i.description === "string" ? i.description : "";
      const cmd = typeof i.command === "string" ? i.command : "";
      return { summary: desc, body: cmd };
    }
    case "Read": {
      const fp = typeof i.file_path === "string" ? i.file_path : "";
      const offset = i.offset != null ? `:${i.offset}` : "";
      return { summary: `${fp}${offset}` };
    }
    case "Write":
    case "Edit": {
      const fp = typeof i.file_path === "string" ? i.file_path : "";
      const old = typeof i.old_string === "string" ? i.old_string : null;
      const next = typeof i.new_string === "string" ? i.new_string : null;
      const content = typeof i.content === "string" ? i.content : null;
      const body =
        old !== null && next !== null
          ? `- ${old}\n+ ${next}`
          : content !== null
            ? content
            : "";
      return { summary: fp, body };
    }
    case "Grep":
    case "Glob": {
      const pattern = typeof i.pattern === "string" ? i.pattern : "";
      const p = typeof i.path === "string" ? ` in ${i.path}` : "";
      return { summary: `${pattern}${p}` };
    }
    case "TodoWrite": {
      const todos = Array.isArray(i.todos) ? i.todos : [];
      return { summary: `${todos.length} todo${todos.length === 1 ? "" : "s"}` };
    }
    case "WebFetch":
    case "WebSearch": {
      const url = typeof i.url === "string" ? i.url : "";
      const query = typeof i.query === "string" ? i.query : "";
      return { summary: url || query };
    }
    default:
      try {
        return { body: JSON.stringify(input, null, 2) };
      } catch {
        return { body: String(input) };
      }
  }
}

/* ─── Tool result ─────────────────────────────────────────── */

function ToolResultBlock({
  content,
  isError,
  query,
}: {
  content: string;
  isError: boolean;
  query: string;
}): JSX.Element {
  const lineCount = content ? content.split("\n").length : 0;
  // Auto-expand when there's an active search query AND the body matches —
  // collapsed-by-default would hide the very thing the user searched for.
  const open = query.trim() !== "" && content.toLowerCase().includes(query.trim().toLowerCase());
  return (
    <details
      open={open}
      className={`sesh-block-tool sesh-block-tool-result ${
        isError ? "is-error" : ""
      }`}
    >
      <summary className="sesh-tool-header">
        <Icon name="chevron-right" className="sesh-tool-chevron" />
        <Icon name={isError ? "error" : "check"} />
        <span className="sesh-tool-name">{isError ? "Error" : "Result"}</span>
        <span className="sesh-tool-summary">
          {lineCount} line{lineCount === 1 ? "" : "s"}
        </span>
      </summary>
      <pre className="sesh-tool-body">
        <Highlight text={content} query={query} />
      </pre>
    </details>
  );
}
