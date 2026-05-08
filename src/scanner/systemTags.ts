// Tags emitted by Claude Code into user messages that carry runtime/IDE state
// rather than the user's own text. Stripped from auto_titles and transcript
// previews so Sesh shows the user's actual prompt.
export const SYSTEM_TAG_RE =
  /<(system-reminder|command-name|command-message|command-args|env|local-command-stdout|local-command-stderr|ide_selection|ide_diagnostics|ide_opened_file|task-notification|task-id|tool-use-id)>[\s\S]*?<\/\1>/g;

export function stripSystemTags(text: string): string {
  return text.replace(SYSTEM_TAG_RE, "").trim();
}
