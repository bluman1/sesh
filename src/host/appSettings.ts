import * as vscode from "vscode";

export interface AppSettings {
  tabs: { sessions: boolean; knowledge: boolean; ideas: boolean; insights: boolean; reviewer: boolean };
  pickUpBanner: boolean;
  pickUpScope: "global" | "workspace";
}

export function readAppSettings(): AppSettings {
  const cfg = vscode.workspace.getConfiguration("sesh");
  return {
    tabs: {
      sessions: true,
      knowledge: cfg.get<boolean>("tabs.knowledge", true),
      ideas: cfg.get<boolean>("tabs.ideas", true),
      insights: cfg.get<boolean>("tabs.insights", true),
      reviewer: cfg.get<boolean>("tabs.reviewer", true),
    },
    pickUpBanner: cfg.get<boolean>("pickUpBanner", true),
    pickUpScope: cfg.get<"global" | "workspace">("pickUpScope", "global"),
  };
}
