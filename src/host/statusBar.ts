import * as vscode from "vscode";
import type { Db } from "../db/connection";
import { todaysStandup } from "../db/analyticsQueries";

export class SeshStatusBar {
  private item: vscode.StatusBarItem;
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly db: Db) {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this.item.command = "sesh.open";
    this.item.tooltip = "Sesh: today's spend (click to open)";
  }

  start(): void {
    this.refresh();
    this.timer = setInterval(() => this.refresh(), 60_000);
  }

  refresh(): void {
    const cfg = vscode.workspace.getConfiguration("sesh");
    if (!cfg.get<boolean>("statusBarShowCost", true)) {
      this.item.hide();
      return;
    }
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const summary = todaysStandup({ db: this.db, todayStart: todayStart.getTime() });
    if (summary.totalSessions === 0) {
      this.item.hide();
      return;
    }
    this.item.text = `$(history) $${summary.totalUsd.toFixed(2)} today`;
    this.item.show();
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    this.item.dispose();
  }
}
