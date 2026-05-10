import { useState, useEffect, useCallback } from "react";
import { onHostMessage, postToHost, type ToWebview } from "../messaging";
import "./SettingsTab.css";

type AppSettingsPayload = Extract<ToWebview, { kind: "appSettings" }>;
type Settings = AppSettingsPayload["settings"];

const NULL_SETTINGS: Settings = {
  tabs: { sessions: true, knowledge: true, ideas: true, insights: true, reviewer: true },
  pickUpBanner: true,
  pickUpScope: "global",
  statusBarShowCost: true,
  archiveTranscripts: false,
  outcomeInferenceDays: 30,
  indexBackfillMode: "eager",
  transcriptLimit: 10000,
  gitIndexerEnabled: true,
  embeddingsEnabled: true,
  embeddingsAutoStart: false,
  ideaMining: true,
  ideaMiningSinceDays: 30,
  embedder: "local",
  embedderModel: "",
  embedderApiKey: "",
  embedderApiUrl: "",
};

function applyKey(prev: Settings, key: string, value: unknown): Settings {
  if (key.startsWith("tabs.")) {
    const sub = key.slice(5) as keyof Settings["tabs"];
    return { ...prev, tabs: { ...prev.tabs, [sub]: value as boolean } };
  }
  return { ...prev, [key as keyof Settings]: value as never };
}

export function SettingsTab(): JSX.Element {
  const [s, setS] = useState<Settings>(NULL_SETTINGS);

  useEffect(() => {
    const off = onHostMessage((msg) => {
      if (msg.kind === "appSettings") setS(msg.settings);
    });
    return off;
  }, []);

  const update = useCallback((key: string, value: unknown) => {
    setS((prev) => applyKey(prev, key, value));
    postToHost({ kind: "setSetting", key, value });
  }, []);

  return (
    <div className="sesh-settings">
      <div className="sesh-settings-body">

        <Section title="Tabs" subtitle="Hide tabs you don't use; the Sessions tab can't be hidden.">
          <Switch label="Knowledge" checked={s.tabs.knowledge} onChange={(v) => update("tabs.knowledge", v)} />
          <Switch label="Ideas" checked={s.tabs.ideas} onChange={(v) => update("tabs.ideas", v)} />
          <Switch label="Insights" checked={s.tabs.insights} onChange={(v) => update("tabs.insights", v)} />
          <Switch label="Reviewer" checked={s.tabs.reviewer} onChange={(v) => update("tabs.reviewer", v)} />
        </Section>

        <Section title="Pick up where you left off" subtitle="The banner above the session list with idea + commitment suggestions.">
          <Switch label="Show banner" checked={s.pickUpBanner} onChange={(v) => update("pickUpBanner", v)} />
          <Select
            label="Suggestion scope"
            value={s.pickUpScope}
            options={[
              { value: "global", label: "Global — every session" },
              { value: "workspace", label: "Workspace — only current repo's sessions" },
            ]}
            onChange={(v) => update("pickUpScope", v)}
          />
        </Section>

        <Section title="Indexing" subtitle="Background work Sesh runs to keep its data fresh.">
          <Select
            label="Session indexing mode"
            value={s.indexBackfillMode}
            options={[
              { value: "eager", label: "Eager — index all sessions at activation" },
              { value: "lazy", label: "Lazy — index a session on first view" },
            ]}
            onChange={(v) => update("indexBackfillMode", v)}
          />
          <Switch label="Index git history (Reviewer tab)" checked={s.gitIndexerEnabled} onChange={(v) => update("gitIndexerEnabled", v)} />
          <Switch label="Build embeddings (Knowledge tab)" checked={s.embeddingsEnabled} onChange={(v) => update("embeddingsEnabled", v)} />
          <Switch
            label="Auto-start embedding indexing at activation"
            description="Default off because the local model load can crash the host on some Electron builds. When off, run 'Sesh: Reindex embeddings' from the command palette."
            checked={s.embeddingsAutoStart}
            onChange={(v) => update("embeddingsAutoStart", v)}
          />
          <Switch label="Mine ideas from user messages" checked={s.ideaMining} onChange={(v) => update("ideaMining", v)} />
          <NumberField
            label="Idea mining lookback (days)"
            value={s.ideaMiningSinceDays}
            min={1}
            onChange={(v) => update("ideaMiningSinceDays", v)}
          />
        </Section>

        <Section title="Embedder" subtitle="Which embedder powers semantic search and the Knowledge tab.">
          <Select
            label="Embedder"
            value={s.embedder}
            options={[
              { value: "local", label: "Local — @huggingface/transformers, on-device" },
              { value: "ollama", label: "Ollama — local HTTP server" },
              { value: "cloud", label: "Cloud — OpenAI-compatible endpoint" },
            ]}
            onChange={(v) => update("embedder", v)}
          />
          <TextField
            label="Model override"
            placeholder="(blank for embedder default)"
            value={s.embedderModel}
            onChange={(v) => update("embedderModel", v)}
          />
          <TextField
            label="API URL override"
            placeholder="(blank for embedder default)"
            value={s.embedderApiUrl}
            onChange={(v) => update("embedderApiUrl", v)}
          />
          <TextField
            label="API key (cloud only)"
            placeholder="paste your key — stored in VSCode settings"
            value={s.embedderApiKey}
            onChange={(v) => update("embedderApiKey", v)}
            secret
          />
        </Section>

        <Section title="Outcomes" subtitle="When sessions get auto-flagged 'abandoned'.">
          <NumberField
            label="Inactivity days before 'abandoned'"
            value={s.outcomeInferenceDays}
            min={1}
            onChange={(v) => update("outcomeInferenceDays", v)}
          />
        </Section>

        <Section title="Misc">
          <Switch label="Show today's spend in status bar" checked={s.statusBarShowCost} onChange={(v) => update("statusBarShowCost", v)} />
          <Switch
            label="Archive transcripts (gzip to ~/.sesh/transcripts/)"
            description="Pruned source JSONLs stay readable from Sesh."
            checked={s.archiveTranscripts}
            onChange={(v) => update("archiveTranscripts", v)}
          />
          <NumberField
            label="Transcript message limit"
            value={s.transcriptLimit}
            min={100}
            onChange={(v) => update("transcriptLimit", v)}
          />
        </Section>

      </div>
    </div>
  );
}

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }): JSX.Element {
  return (
    <section className="sesh-settings-section">
      <div className="sesh-settings-section-head">
        <span className="sesh-settings-section-title">{title}</span>
        {subtitle && <span className="sesh-settings-section-subtitle">{subtitle}</span>}
      </div>
      <div className="sesh-settings-rows">{children}</div>
    </section>
  );
}

function Switch({ label, description, checked, onChange }: { label: string; description?: string; checked: boolean; onChange: (v: boolean) => void }): JSX.Element {
  return (
    <div
      className="sesh-settings-row sesh-settings-row-clickable"
      onClick={() => onChange(!checked)}
    >
      <div className="sesh-settings-row-text">
        <span className="sesh-settings-row-label">{label}</span>
        {description && <span className="sesh-settings-row-description">{description}</span>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        className={`sesh-switch${checked ? " is-on" : ""}`}
        onClick={(e) => {
          e.stopPropagation();
          onChange(!checked);
        }}
      >
        <span className="sesh-switch-knob" />
      </button>
    </div>
  );
}

function Select<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }): JSX.Element {
  return (
    <label className="sesh-settings-row">
      <div className="sesh-settings-row-text">
        <span className="sesh-settings-row-label">{label}</span>
      </div>
      <div className="sesh-settings-select-wrap">
        <select
          className="sesh-settings-select"
          value={value}
          onChange={(e) => onChange(e.target.value as T)}
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <span className="codicon codicon-chevron-down sesh-settings-select-chevron" aria-hidden />
      </div>
    </label>
  );
}

function NumberField({ label, value, min, onChange }: { label: string; value: number; min?: number; onChange: (v: number) => void }): JSX.Element {
  return (
    <label className="sesh-settings-row">
      <div className="sesh-settings-row-text">
        <span className="sesh-settings-row-label">{label}</span>
      </div>
      <input
        type="number"
        className="sesh-settings-number"
        value={value}
        min={min}
        onChange={(e) => {
          const v = parseInt(e.target.value, 10);
          if (!isNaN(v)) onChange(v);
        }}
      />
    </label>
  );
}

function TextField({ label, value, placeholder, onChange, secret }: { label: string; value: string; placeholder?: string; onChange: (v: string) => void; secret?: boolean }): JSX.Element {
  return (
    <label className="sesh-settings-row">
      <div className="sesh-settings-row-text">
        <span className="sesh-settings-row-label">{label}</span>
      </div>
      <input
        type={secret ? "password" : "text"}
        className="sesh-settings-text"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}
