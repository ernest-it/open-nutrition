import { createContext, useContext } from 'react';
import type { Meal } from '@open-nutrition/shared';

export type AddTab = 'search' | 'barcode' | 'photo' | 'quick' | 'saved';
export interface AddRequest {
  day: string;
  meal: Meal;
  tab?: AddTab;
}

export const AddFoodContext = createContext<(req: AddRequest) => void>(() => {});
/** Open the "Add food" sheet for a day and meal. */
export const useAddFood = () => useContext(AddFoodContext);
