import * as vscode from "vscode";

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("sesh.open", () => {
      vscode.window.showInformationMessage("Sesh: Open (stub)");
    }),
    vscode.commands.registerCommand("sesh.showStats", () => {
      vscode.window.showInformationMessage("Sesh: stats (stub)");
    }),
  );
}

export function deactivate(): void {}
