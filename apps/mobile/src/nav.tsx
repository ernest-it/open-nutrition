import { createContext, useContext } from 'react';
import type { Food, FoodData, Meal, NutrientKey } from '@open-nutrition/shared';

/** Minimal stack navigation per tab (keeps native dependencies to a minimum). */
export type Route =
  | { name: 'today' }
  | { name: 'diary' }
  | { name: 'nutrients' }
  | { name: 'more' }
  | { name: 'body' }
  | { name: 'foods' }
  | { name: 'settings' }
  | { name: 'entry'; id: string }
  | { name: 'foodEdit'; id?: string; barcode?: string }
  | { name: 'recipeEdit'; id?: string }
  | { name: 'savedMeal'; id: string }
  | { name: 'targets' }
  | { name: 'profile' }
  | { name: 'menuImport' }
  | { name: 'topFoods'; key: NutrientKey; from: string; to: string };

/** Root screens. The bottom bar shows today/diary/+/nutrients/more; the rail lists body/foods/settings directly. */
export type Tab = 'today' | 'diary' | 'nutrients' | 'more' | 'body' | 'foods' | 'settings';

export interface AddOptions {
  day: string;
  meal?: Meal;
  /** Open straight into one of the add flows. */
  start?: 'search' | 'scan' | 'ai' | 'quick' | 'saved';
}

export interface Nav {
  push: (r: Route) => void;
  pop: () => void;
  /** Replace the top route (used by two-pane layouts). */
  replace: (r: Route) => void;
  switchTab: (t: Tab) => void;
  openAdd: (o: AddOptions) => void;
}

export const NavContext = createContext<Nav>({ push: () => {}, pop: () => {}, replace: () => {}, switchTab: () => {}, openAdd: () => {} });
export const useNav = () => useContext(NavContext);

/** Routes inside the Add sheet. */
export type AddRoute =
  | { name: 'hub' }
  | { name: 'food'; food: Food | FoodData; offSource?: boolean }
  | { name: 'scan' }
  | { name: 'ai' }
  | { name: 'quick' }
  | { name: 'saved' }
  | { name: 'recipe'; id: string }
  | { name: 'savedMeal'; id: string }
  | { name: 'newFood'; barcode?: string; initialName?: string };

export interface AddNav {
  day: string;
  meal: Meal;
  setMeal: (m: Meal) => void;
  push: (r: AddRoute) => void;
  pop: () => void;
  replace: (r: AddRoute) => void;
  /** Close the sheet (after logging, pass a confirmation message). */
  close: (message?: string, undo?: () => void) => void;
  /** While set, hardware back calls this instead of leaving the screen (e.g. to confirm discarding an AI estimate). */
  setBackGuard: (fn: (() => void) | null) => void;
}

export const AddNavContext = createContext<AddNav | null>(null);
export function useAddNav(): AddNav {
  const n = useContext(AddNavContext);
  if (!n) throw new Error('useAddNav outside the Add sheet');
  return n;
}
