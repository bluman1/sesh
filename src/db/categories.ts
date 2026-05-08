import type { Db } from "./connection";

export interface Category {
  id: number;
  name: string;
  color: string | null;
  sort_order: number;
}

export class CategoryRepository {
  constructor(private db: Db) {}

  create(input: Omit<Category, "id">): Category {
    const result = this.db
      .prepare(
        "INSERT INTO categories (name, color, sort_order) VALUES (?, ?, ?)",
      )
      .run(input.name, input.color, input.sort_order);
    return { id: Number(result.lastInsertRowid), ...input };
  }

  listAll(): Category[] {
    return this.db
      .prepare(
        "SELECT id, name, color, sort_order FROM categories ORDER BY sort_order ASC, name ASC",
      )
      .all() as Category[];
  }

  rename(id: number, name: string): void {
    this.db.prepare("UPDATE categories SET name = ? WHERE id = ?").run(name, id);
  }

  delete(id: number): void {
    this.db.prepare("DELETE FROM categories WHERE id = ?").run(id);
  }
}
