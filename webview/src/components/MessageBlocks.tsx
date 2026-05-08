import { diffLines } from "diff";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { TranscriptBlock } from "../messaging";
import { CodeBlock } from "./CodeBlock";
import { Highlight } from "./Highlight";
import { Icon } from "./Icon";

const MARKDOWN_COMPONENTS = { code: CodeBlock } as const;

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
    case "image":
      return <ImageBlock mediaType={block.mediaType} data={block.data} />;
  }
}

/* ─── Image ───────────────────────────────────────────────── */

function ImageBlock({
  mediaType,
  data,
}: {
  mediaType: string;
  data: string;
}): JSX.Element {
  return (
    <figure className="sesh-block-image">
      <img src={`data:${mediaType};base64,${data}`} alt="" loading="lazy" />
    </figure>
  );
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
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={MARKDOWN_COMPONENTS}
      >{text}</ReactMarkdown>
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
        <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={MARKDOWN_COMPONENTS}
      >{text}</ReactMarkdown>
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

const TOOL_ICONS: Record<string, string> = {
  Bash: "terminal",
  Read: "file",
  Write: "new-file",
  Edit: "edit",
  Grep: "search",
  Glob: "folder-opened",
  TodoWrite: "checklist",
  TodoRead: "checklist",
  WebFetch: "cloud-download",
  WebSearch: "globe",
  NotebookEdit: "notebook",
  Task: "robot",
  Agent: "robot",
};

function ToolUseBlock({ name, input }: ToolUseProps): JSX.Element {
  const formatted = formatToolInput(name, input);
  const hasBody = formatted.body !== undefined;
  const icon = TOOL_ICONS[name] ?? "play";
  return (
    <details className="sesh-block-tool sesh-block-tool-use">
      <summary className="sesh-tool-header">
        <Icon name="chevron-right" className="sesh-tool-chevron" />
        <Icon name={icon} />
        <span className="sesh-tool-name">{name}</span>
        {formatted.summary && (
          <span className="sesh-tool-summary" title={formatted.summary}>
            {formatted.summary}
          </span>
        )}
        {!hasBody && <span className="sesh-tool-empty">no input</span>}
      </summary>
      {hasBody && renderBody(formatted.body!)}
    </details>
  );
}

type DiffKind = "add" | "remove" | "context";
interface DiffLine {
  kind: DiffKind;
  text: string;
}

type FormattedBody =
  | { kind: "plain"; text: string }
  | { kind: "diff"; lines: DiffLine[] };

interface FormattedTool {
  summary?: string;
  body?: FormattedBody;
}

function renderBody(body: FormattedBody): JSX.Element {
  if (body.kind === "diff") {
    return (
      <pre className="sesh-tool-body sesh-diff">
        {body.lines.map((l, i) => (
          <div key={i} className={`sesh-diff-line is-${l.kind}`}>
            <span className="sesh-diff-marker">
              {l.kind === "add" ? "+" : l.kind === "remove" ? "-" : " "}
            </span>
            <span className="sesh-diff-text">{l.text || " "}</span>
          </div>
        ))}
      </pre>
    );
  }
  return <pre className="sesh-tool-body">{body.text}</pre>;
}

function buildDiff(
  oldStr: string | null,
  newStr: string | null,
  content: string | null,
): DiffLine[] {
  if (oldStr !== null && newStr !== null) {
    const lines: DiffLine[] = [];
    for (const part of diffLines(oldStr, newStr)) {
      const kind: DiffKind = part.added
        ? "add"
        : part.removed
          ? "remove"
          : "context";
      const segments = part.value.split("\n");
      // diffLines preserves trailing newline as a final empty segment — drop it
      // so we don't render a phantom blank line between parts.
      if (segments.length && segments[segments.length - 1] === "") {
        segments.pop();
      }
      for (const s of segments) lines.push({ kind, text: s });
    }
    return lines;
  }
  const text = content ?? newStr ?? "";
  return text.split("\n").map((s) => ({ kind: "add" as const, text: s }));
}

function formatToolInput(name: string, input: unknown): FormattedTool {
  if (!input || typeof input !== "object") {
    const v = String(input ?? "");
    return v ? { body: { kind: "plain", text: v } } : {};
  }
  const i = input as Record<string, unknown>;
  switch (name) {
    case "Bash": {
      const desc = typeof i.description === "string" ? i.description : "";
      const cmd = typeof i.command === "string" ? i.command : "";
      return cmd
        ? { summary: desc, body: { kind: "plain", text: cmd } }
        : { summary: desc };
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
      if (old === null && next === null && content === null) {
        return { summary: fp };
      }
      const lines = buildDiff(old, next, content);
      return { summary: fp, body: { kind: "diff", lines } };
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
        return { body: { kind: "plain", text: JSON.stringify(input, null, 2) } };
      } catch {
        return { body: { kind: "plain", text: String(input) } };
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
