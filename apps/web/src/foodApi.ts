import type { AiEffort, Food, FoodData, MealEstimate, MenuImport } from '@open-nutrition/shared';
import { api, ApiError, store } from './state';

/** Bundled USDA search on the server (`usda:` builtin ids). */
export async function searchFoods(q: string, limit = 25, signal?: AbortSignal): Promise<Food[]> {
  const r = await api<{ foods: Food[] }>(`/api/v1/foods/search?q=${encodeURIComponent(q)}&limit=${limit}`, { signal });
  return r.foods ?? [];
}

/** null until known; false once the server said it has no USDA key (stop asking). */
let brandedEnabled: boolean | null = null;
export const brandedSearchAvailable = () => brandedEnabled === true;

/**
 * Packaged foods (USDA FoodData Central, Branded) via the server. Returns null when the server
 * has packaged-food search turned off.
 */
export async function searchBranded(q: string, signal?: AbortSignal): Promise<Food[] | null> {
  if (brandedEnabled === false) return null;
  try {
    const r = await api<{ foods: Food[] }>(`/api/v1/foods/branded?q=${encodeURIComponent(q)}`, { signal });
    brandedEnabled = true;
    return r.foods ?? [];
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) {
      brandedEnabled = false;
      return null;
    }
    throw e;
  }
}

/** The user's own foods (custom, favourites, cached) whose name or brand matches. */
export function searchLocalFoods(q: string, limit = 15): Food[] {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  return store
    .all('foods')
    .filter((f) => {
      const hay = `${f.name} ${f.brand ?? ''}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    })
    .sort((a, b) => Number(b.favorite) - Number(a.favorite) || a.name.length - b.name.length)
    .slice(0, limit);
}

export type BarcodeSource = 'off' | 'usda_branded' | 'local' | null;

export async function lookupBarcode(code: string): Promise<{ food: Food | FoodData | null; source: BarcodeSource }> {
  const local = store.foodByBarcode(code);
  if (local) return { food: local, source: 'local' };
  try {
    const r = await api<{ food: FoodData | null; source: 'off' | 'usda_branded' | null }>(
      `/api/v1/foods/barcode/${encodeURIComponent(code)}`,
    );
    return { food: r.food ? { ...r.food, favorite: r.food.favorite ?? false } : null, source: r.food ? r.source : null };
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return { food: null, source: null };
    throw e;
  }
}

export interface AiStatus {
  enabled: boolean;
  models: string[];
  defaultModel: string;
  monthlyLimit: number;
  usedThisMonth: number;
}

let aiStatusCache: { at: number; value: AiStatus } | null = null;

/** Server AI status; a server without the endpoint (or an error) counts as disabled. */
export async function getAiStatus(force = false): Promise<AiStatus> {
  if (!force && aiStatusCache && Date.now() - aiStatusCache.at < 60_000) return aiStatusCache.value;
  let value: AiStatus;
  try {
    value = await api<AiStatus>('/api/v1/ai/status');
  } catch {
    value = { enabled: false, models: [], defaultModel: '', monthlyLimit: 0, usedThisMonth: 0 };
  }
  aiStatusCache = { at: Date.now(), value };
  return value;
}

export interface AiEstimateResponse {
  estimate: MealEstimate;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export async function requestEstimate(body: {
  imageBase64?: string;
  mediaType?: string;
  description?: string;
  model?: string;
  effort?: AiEffort;
}): Promise<AiEstimateResponse> {
  try {
    const r = await api<AiEstimateResponse>('/api/v1/ai/estimate', { method: 'POST', body: JSON.stringify(body) });
    aiStatusCache = null;
    return r;
  } catch (e) {
    if (e instanceof ApiError) {
      if (e.status === 503) throw new Error('AI meal logging is not set up on this server. Ask the server admin to add an API key.');
      if (e.status === 413) throw new Error('That photo is too large. Try a smaller one.');
      if (e.status === 429) throw new Error(e.message || 'You have reached the monthly AI limit.');
    }
    throw e;
  }
}

/** Downscale an image so its long side is at most `max` px and re-encode as JPEG. */
export async function downscaleImage(file: File, max = 1024, quality = 0.85): Promise<{ base64: string; dataUrl: string }> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('Could not read that image.'));
      i.src = url;
    });
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('This browser cannot process images.');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    const dataUrl = canvas.toDataURL('image/jpeg', quality);
    return { dataUrl, base64: dataUrl.slice(dataUrl.indexOf(',') + 1) };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** SHA-256 hex of a base64 payload (null where WebCrypto is unavailable, e.g. plain http). */
export async function sha256Base64(base64: string): Promise<string | null> {
  try {
    if (!crypto?.subtle) return null;
    const bin = atob(base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return null;
  }
}

export interface MenuImportResponse {
  menu: MenuImport;
  model: string;
  costUsd: number;
}

/** Import from a nutrition page (the server fetches the link, or uses pasted text). */
export async function importMenu(body: { url?: string; text?: string }): Promise<MenuImportResponse> {
  try {
    const r = await api<MenuImportResponse>('/api/v1/ai/menu-import', { method: 'POST', body: JSON.stringify(body) });
    aiStatusCache = null;
    return r;
  } catch (e) {
    if (e instanceof ApiError && e.status === 503) throw new Error('AI is not set up on this server. Ask the server admin to add an API key.');
    throw e;
  }
}
