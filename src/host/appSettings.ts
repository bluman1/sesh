import * as vscode from "vscode";

export interface AppSettings {
  tabs: { sessions: boolean; knowledge: boolean; ideas: boolean; insights: boolean; reviewer: boolean };
  pickUpBanner: boolean;
  pickUpScope: "global" | "workspace";
  statusBarShowCost: boolean;
  archiveTranscripts: boolean;
  outcomeInferenceDays: number;
  indexBackfillMode: "eager" | "lazy";
  transcriptLimit: number;
  gitIndexerEnabled: boolean;
  embeddingsEnabled: boolean;
  embeddingsAutoStart: boolean;
  ideaMining: boolean;
  ideaMiningSinceDays: number;
  embedder: "local" | "ollama" | "cloud";
  embedderModel: string;
  embedderApiKey: string;
  embedderApiUrl: string;
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
    statusBarShowCost: cfg.get<boolean>("statusBarShowCost", true),
    archiveTranscripts: cfg.get<boolean>("archiveTranscripts", false),
    outcomeInferenceDays: cfg.get<number>("outcomeInferenceDays", 30),
    indexBackfillMode: cfg.get<"eager" | "lazy">("indexBackfillMode", "eager"),
    transcriptLimit: cfg.get<number>("transcriptLimit", 10000),
    gitIndexerEnabled: cfg.get<boolean>("gitIndexerEnabled", true),
    embeddingsEnabled: cfg.get<boolean>("embeddingsEnabled", true),
    embeddingsAutoStart: cfg.get<boolean>("embeddingsAutoStart", false),
    ideaMining: cfg.get<boolean>("ideaMining", true),
    ideaMiningSinceDays: cfg.get<number>("ideaMiningSinceDays", 30),
    embedder: cfg.get<"local" | "ollama" | "cloud">("embedder", "local"),
    embedderModel: cfg.get<string>("embedderModel", ""),
    embedderApiKey: cfg.get<string>("embedderApiKey", ""),
    embedderApiUrl: cfg.get<string>("embedderApiUrl", ""),
  };
}
