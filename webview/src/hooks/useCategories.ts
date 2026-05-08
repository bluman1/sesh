import { useEffect, useState } from "react";
import { onHostMessage, postToHost } from "../messaging";

export interface Category {
  id: number;
  name: string;
  color: string | null;
  sort_order: number;
}

export function useCategories(): {
  categories: Category[];
  create: (name: string, color: string | null, assignToSessionId?: string) => void;
  rename: (id: number, name: string) => void;
  remove: (id: number) => void;
} {
  const [categories, setCategories] = useState<Category[]>([]);

  useEffect(() => {
    const dispose = onHostMessage((msg) => {
      if (msg.kind === "categoriesList") setCategories(msg.categories);
    });
    postToHost({ kind: "listCategories" });
    return dispose;
  }, []);

  return {
    categories,
    create: (name, color, assignToSessionId) =>
      postToHost({ kind: "createCategory", name, color, assignToSessionId }),
    rename: (id, name) => postToHost({ kind: "renameCategory", id, name }),
    remove: (id) => postToHost({ kind: "deleteCategory", id }),
  };
}
