import * as vscode from "vscode";
import { SeshHost } from "./host/seshHost";

let host: SeshHost | null = null;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const output = vscode.window.createOutputChannel("Sesh");
  context.subscriptions.push(output);

  host = new SeshHost(output);

  context.subscriptions.push(
    vscode.commands.registerCommand("sesh.open", () => {
      vscode.window.showInformationMessage("Sesh: Open (UI ships in Plan B)");
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

export function deactivate(): void {
  host?.stop();
  host = null;
}
