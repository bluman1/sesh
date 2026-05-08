import { useEffect, useState } from "react";
import { onHostMessage, postToHost, type ProjectFolder } from "../messaging";

export function useProjects(): ProjectFolder[] {
  const [projects, setProjects] = useState<ProjectFolder[]>([]);

  useEffect(() => {
    const dispose = onHostMessage((msg) => {
      if (msg.kind === "projectsList") setProjects(msg.projects);
    });
    postToHost({ kind: "listProjects" });
    return dispose;
  }, []);

  return projects;
}
