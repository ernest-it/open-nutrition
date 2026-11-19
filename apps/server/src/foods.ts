// Read-only access to the bundled USDA food database (apps/mobile/assets/foods.db).

import Database from 'better-sqlite3';
import fs from 'node:fs';
import {
  FOOD_BY_ID_SQL,
  FOOD_SEARCH_CANDIDATES,
  FOOD_SEARCH_SQL,
  builtinFdcId,
  ftsQuery,
  rankFoods,
  rowToFood,
  type Food,
  type FoodDbRow,
} from '@open-nutrition/shared';

export const MAX_SEARCH_LIMIT = 50;

export class FoodDb {
  private db: Database.Database;
  private searchStmt: Database.Statement<[string, number]>;
  private byIdStmt: Database.Statement<[number]>;

  constructor(file: string) {
    this.db = new Database(file, { readonly: true, fileMustExist: true });
    this.searchStmt = this.db.prepare(FOOD_SEARCH_SQL);
    this.byIdStmt = this.db.prepare(FOOD_BY_ID_SQL);
  }

  /** Ranked search (the shared recipe: FTS candidates, then rankFoods). */
  search(text: string, limit = 20): Food[] {
    const q = ftsQuery(text);
    if (!q) return [];
    const rows = this.searchStmt.all(q, FOOD_SEARCH_CANDIDATES) as FoodDbRow[];
    return rankFoods(text, rows)
      .slice(0, Math.max(1, Math.min(MAX_SEARCH_LIMIT, limit)))
      .map(rowToFood);
  }

  /** A bundled food by its `usda:<fdcId>` id (or bare fdcId). */
  byId(id: string): Food | null {
    const fdcId = /^\d+$/.test(id) ? Number(id) : builtinFdcId(id);
    if (!fdcId) return null;
    const row = this.byIdStmt.get(fdcId) as FoodDbRow | undefined;
    return row ? rowToFood(row) : null;
  }

  close() {
    this.db.close();
  }
}

/** Open the food DB, or null (with a reason) when it is missing or unreadable. */
export function openFoodDb(file: string): { db: FoodDb | null; error: string | null } {
  if (!fs.existsSync(file)) return { db: null, error: `food database not found at ${file}` };
  try {
    return { db: new FoodDb(file), error: null };
  } catch (e) {
    return { db: null, error: `could not open food database at ${file}: ${(e as Error).message}` };
  }
}
