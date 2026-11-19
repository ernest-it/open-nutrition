// AI meal estimates from the phone.
//
// * Server mode: POST /api/v1/ai/estimate on the user's server (the server holds the key).
// * Local mode (bring your own key): the Anthropic key lives ONLY in expo-secure-store under
//   its own entry (Keychain / Keystore). It is never written to synced settings, the store
//   snapshot, logs or crash reports, and it is only ever sent to api.anthropic.com.

import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import {
  ANTHROPIC_MESSAGES_URL,
  AiError,
  aiErrorFromHttp,
  anthropicHeaders,
  buildMealEstimateRequest,
  estimateCostUsd,
  parseMealEstimateResponse,
  MealEstimate,
  type AiEffort,
  type AiErrorCode,
} from '@open-nutrition/shared';
import { serverFetch, type Account } from './state';

const KEY_ENTRY = 'on.anthropicApiKey';

export async function getApiKey(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(KEY_ENTRY);
  } catch {
    return null;
  }
}

export async function setApiKey(key: string): Promise<void> {
  await SecureStore.setItemAsync(KEY_ENTRY, key.trim(), { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
}

export async function removeApiKey(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(KEY_ENTRY);
  } catch {
    /* already gone */
  }
}

/** A loose sanity check before saving (the API is the real judge). */
export const looksLikeAnthropicKey = (k: string) => /^sk-ant-[A-Za-z0-9_-]{20,}$/.test(k.trim());

// ---- images ------------------------------------------------------------------------------------

export interface PreparedImage {
  base64: string;
  uri: string;
  width: number;
  height: number;
  /** SHA-256 (hex) of the JPEG bytes that are sent. */
  sha256: string;
}

const LONG_SIDE = 1024;

/** Resize to ~1024 px on the long side, re-encode as JPEG, and hash the result. */
export async function prepareImage(uri: string, width?: number, height?: number): Promise<PreparedImage> {
  const ctx = ImageManipulator.manipulate(uri);
  const w = width ?? 0;
  const h = height ?? 0;
  if (w > 0 && h > 0) {
    if (Math.max(w, h) > LONG_SIDE) ctx.resize(w >= h ? { width: LONG_SIDE } : { height: LONG_SIDE });
  } else {
    ctx.resize({ width: LONG_SIDE });
  }
  const ref = await ctx.renderAsync();
  const out = await ref.saveAsync({ format: SaveFormat.JPEG, compress: 0.75, base64: true });
  if (!out.base64) throw new Error('Could not read the photo.');
  return { base64: out.base64, uri: out.uri, width: out.width, height: out.height, sha256: await sha256OfBase64(out.base64) };
}

async function sha256OfBase64(b64: string): Promise<string> {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const digest = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ---- estimate ----------------------------------------------------------------------------------

export interface EstimateResult {
  estimate: MealEstimate;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number | null;
}

export interface EstimateInput {
  model: string;
  effort: AiEffort;
  imageBase64?: string | null;
  description?: string | null;
}

const TIMEOUT_MS = 120_000;

export async function requestEstimate(account: Account, input: EstimateInput): Promise<EstimateResult> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    return account.server ? await viaServer(account, input, ctrl.signal) : await direct(input, ctrl.signal);
  } catch (e) {
    if (e instanceof AiError) throw e;
    if ((e as Error).name === 'AbortError') throw new AiError('api_error', 'The AI took too long to answer. Try again.');
    throw new AiError('api_error', `Could not reach the AI service: ${(e as Error).message}`);
  } finally {
    clearTimeout(timer);
  }
}

async function viaServer(account: Account, input: EstimateInput, signal: AbortSignal): Promise<EstimateResult> {
  const res = await serverFetch(account, '/api/v1/ai/estimate', {
    method: 'POST',
    body: JSON.stringify({
      imageBase64: input.imageBase64 ?? undefined,
      mediaType: input.imageBase64 ? 'image/jpeg' : undefined,
      description: input.description?.trim() || undefined,
      model: input.model,
      effort: input.effort,
    }),
    signal,
  });
  const text = await res.text();
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    /* not JSON */
  }
  if (!res.ok) {
    const msg = typeof body.error === 'string' ? body.error : typeof body.message === 'string' ? body.message : null;
    const code = typeof body.code === 'string' ? (body.code as AiErrorCode) : null;
    if (code && res.status !== 401) throw new AiError(code, msg ?? 'The AI request failed.');
    if (res.status === 503) throw new AiError('not_configured', msg ?? 'AI logging is not set up on your server.');
    if (res.status === 429) throw new AiError('limit_reached', msg ?? 'You have reached this month’s AI limit on your server.');
    if (res.status === 401) throw new AiError('auth', 'Your session has expired. Sign in again.');
    throw new AiError('api_error', msg ?? `The AI request failed (HTTP ${res.status}).`);
  }
  const parsed = MealEstimate.safeParse(body.estimate);
  if (!parsed.success) throw new AiError('invalid_response', 'The server returned an unexpected AI answer. Please try again.');
  return {
    estimate: parsed.data,
    model: String(body.model ?? input.model),
    inputTokens: Number(body.inputTokens ?? 0),
    outputTokens: Number(body.outputTokens ?? 0),
    costUsd: typeof body.costUsd === 'number' ? body.costUsd : null,
  };
}

async function direct(input: EstimateInput, signal: AbortSignal): Promise<EstimateResult> {
  const key = await getApiKey();
  if (!key) throw new AiError('not_configured', 'Add your Anthropic API key in Settings → AI first.');
  const body = buildMealEstimateRequest({
    model: input.model,
    effort: input.effort,
    imageBase64: input.imageBase64,
    mediaType: input.imageBase64 ? 'image/jpeg' : null,
    description: input.description,
  });
  const res = await fetch(ANTHROPIC_MESSAGES_URL, {
    method: 'POST',
    headers: anthropicHeaders(key, body, { browser: true }),
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) throw aiErrorFromHttp(res.status, await res.text());
  const r = parseMealEstimateResponse(await res.json());
  return {
    estimate: r.estimate,
    model: r.model || input.model,
    inputTokens: r.inputTokens,
    outputTokens: r.outputTokens,
    costUsd: estimateCostUsd(r.model || input.model, r.inputTokens, r.outputTokens, {
      readTokens: r.cacheReadInputTokens,
      writeTokens: r.cacheCreationInputTokens,
    }),
  };
}

export interface ServerAiStatus {
  enabled: boolean;
  models: string[];
  defaultModel: string;
  monthlyLimit: number;
  usedThisMonth: number;
}

export async function fetchServerAiStatus(account: Account): Promise<ServerAiStatus | null> {
  try {
    const res = await serverFetch(account, '/api/v1/ai/status');
    if (!res.ok) return null;
    return (await res.json()) as ServerAiStatus;
  } catch {
    return null;
  }
}

/** "≈3¢" / "<0.1¢" / "≈$0.12". */
export function formatCost(usd: number): string {
  const cents = usd * 100;
  if (cents < 0.1) return '<0.1¢';
  if (cents < 10) return `≈${+cents.toFixed(cents < 1 ? 1 : 0)}¢`;
  return `≈$${usd.toFixed(2)}`;
}
