import * as vscode from "vscode";
import { SeshHost } from "./host/seshHost";
import { SeshPanel } from "./host/seshPanel";

let host: SeshHost | null = null;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const output = vscode.window.createOutputChannel("Sesh");
  context.subscriptions.push(output);

  host = new SeshHost(output);

  context.subscriptions.push(
    vscode.commands.registerCommand("sesh.open", () => {
      if (!host) {
        vscode.window.showWarningMessage("Sesh is not running.");
        return;
      }
      SeshPanel.openOrFocus(context, host);
    }),
    vscode.commands.registerCommand("sesh.showStats", () => {
      if (!host?.sessions) {
        vscode.window.showWarningMessage("Sesh is still starting up.");
        return;
      }
      const total = host.sessions.countAll();
      vscode.window.showInformationMessage(`Sesh: ${total} sessions indexed.`);
    }),
  );

  try {
    await host.start();
  } catch (err) {
    output.appendLine(`[sesh] activation error: ${(err as Error).message}`);
    vscode.window.showErrorMessage(`Sesh failed to start: ${(err as Error).message}`);
  }
}

export async function deactivate(): Promise<void> {
  await host?.stop();
  host = null;
}
