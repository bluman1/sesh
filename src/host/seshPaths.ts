import * as os from "node:os";
import * as path from "node:path";

// All Sesh-internal CLI invocations (e.g. the title generator's `claude -p`
// and `codex exec -` calls) run with this directory as their working dir.
// Claude Code and Codex both record cwd in their JSONL, so we can recognise
// the resulting sessions and exclude them from Sesh's own list — otherwise
// every Generate Title click would litter the user's session list with the
// generator's own meta-conversations.
//
// IMPORTANT: keep this constant. The scanners filter on equality, not a
// substring match, so renaming this would silently start letting old
// Sesh-generated sessions back into the list (and old ones would still leak
// through forever). If you ever do change it, add a one-time DB cleanup pass.
export const SESH_META_CWD = path.join(os.homedir(), ".sesh", "cli");
