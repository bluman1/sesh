import { Icon } from "./Icon";

interface SourceMeta {
  icon: string;
  label: string;
}

const SOURCES: Record<string, SourceMeta> = {
  "claude-code": { icon: "claude", label: "Claude Code" },
  codex: { icon: "openai", label: "Codex" },
};

const FALLBACK: SourceMeta = { icon: "symbol-misc", label: "Unknown source" };

interface Props {
  source: string;
  showLabel?: boolean;
  className?: string;
}

export function SourceBadge({ source, showLabel, className }: Props): JSX.Element {
  const meta = SOURCES[source] ?? FALLBACK;
  return (
    <span
      className={`sesh-source ${className ?? ""}`}
      title={meta.label}
    >
      <Icon name={meta.icon} />
      {showLabel && <span className="sesh-source-label">{meta.label}</span>}
    </span>
  );
}
