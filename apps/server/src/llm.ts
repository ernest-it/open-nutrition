// AI meal estimates via Claude (official Anthropic SDK).
//
// AI is Anthropic-only for now: meal estimates need vision plus structured JSON
// output, so the OpenAI-compatible provider from Open Workouts was removed.
//
//   LLM_PROVIDER=anthropic
//   LLM_API_KEY=sk-ant-...      (or ANTHROPIC_API_KEY)
//   LLM_MODEL=claude-opus-5-5   (default)
//   LLM_EFFORT=low              (low | medium | high)
//
// The request body is built by @open-nutrition/shared (the same body the phone
// sends in bring-your-own-key mode). Neither the key nor image data is logged.

import Anthropic from '@anthropic-ai/sdk';
import {
  AiError,
  aiErrorFromHttp,
  buildMealEstimateRequest,
  buildMenuImportRequest,
  estimateCostUsd,
  mealEstimateBetas,
  parseMealEstimateResponse,
  parseMenuImportResponse,
  type AiEffort,
  type MealEstimate,
  type MenuImport,
  type MenuPage,
} from '@open-nutrition/shared';
import type { Config } from './config';

/** The part of the SDK client we use (lets tests inject a fake). */
export type AnthropicClient = Pick<Anthropic, 'messages' | 'beta'>;

export interface EstimateInput {
  model: string;
  effort: AiEffort;
  imageBase64?: string | null;
  mediaType?: string | null;
  description?: string | null;
}

export interface EstimateOutput {
  estimate: MealEstimate;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface MenuOutput {
  menu: MenuImport;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface MealEstimator {
  estimate(input: EstimateInput): Promise<EstimateOutput>;
  /** Transcribe a restaurant nutrition page (import from a nutrition page). */
  readMenu(input: { page: MenuPage; model: string; effort: AiEffort }): Promise<MenuOutput>;
}

export class AnthropicMealEstimator implements MealEstimator {
  constructor(private client: AnthropicClient) {}

  async estimate(input: EstimateInput): Promise<EstimateOutput> {
    const body = buildMealEstimateRequest(input); // throws AiError('no_input')
    const betas = mealEstimateBetas(body);
    let msg: unknown;
    try {
      msg = betas.length
        ? await this.client.beta.messages.create({ ...body, betas } as unknown as Anthropic.Beta.MessageCreateParamsNonStreaming)
        : await this.client.messages.create(body as unknown as Anthropic.MessageCreateParamsNonStreaming);
    } catch (e) {
      throw toAiError(e);
    }
    const r = parseMealEstimateResponse(msg);
    const costUsd = estimateCostUsd(r.model, r.inputTokens, r.outputTokens, {
      readTokens: r.cacheReadInputTokens,
      writeTokens: r.cacheCreationInputTokens,
    });
    return { estimate: r.estimate, model: r.model, inputTokens: r.inputTokens, outputTokens: r.outputTokens, costUsd };
  }

  async readMenu(input: { page: MenuPage; model: string; effort: AiEffort }): Promise<MenuOutput> {
    const body = buildMenuImportRequest(input);
    const betas = mealEstimateBetas(body);
    let msg: unknown;
    try {
      // Streamed: a whole menu can be a long answer (avoids HTTP timeouts on big max_tokens).
      msg = betas.length
        ? await this.client.beta.messages.stream({ ...body, betas } as unknown as Anthropic.Beta.MessageCreateParamsStreaming, { timeout: 600_000 }).finalMessage()
        : await this.client.messages.stream(body as unknown as Anthropic.MessageCreateParamsStreaming, { timeout: 600_000 }).finalMessage();
    } catch (e) {
      throw toAiError(e);
    }
    const r = parseMenuImportResponse(msg);
    const costUsd = estimateCostUsd(r.model, r.inputTokens, r.outputTokens, { readTokens: r.cacheReadInputTokens, writeTokens: r.cacheCreationInputTokens });
    return { menu: r.menu, model: r.model, inputTokens: r.inputTokens, outputTokens: r.outputTokens, costUsd };
  }
}

/** SDK/transport errors → AiError with a message safe to show users (server mode wording). */
export function toAiError(e: unknown): AiError {
  if (e instanceof AiError) return e;
  if (e instanceof Anthropic.APIConnectionError) {
    return new AiError('api_error', 'Could not reach the AI service. Try again shortly.');
  }
  if (e instanceof Anthropic.APIError && typeof e.status === 'number') {
    const err = aiErrorFromHttp(e.status);
    if (err.code === 'auth') return new AiError('auth', "The server's AI key was rejected. Ask the server admin to check it.");
    return err;
  }
  return new AiError('api_error', 'The AI request failed.');
}

/** HTTP status for an AiError returned by the server API. */
export function aiErrorStatus(code: AiError['code']): number {
  switch (code) {
    case 'no_input':
      return 400;
    case 'refusal':
      return 422;
    case 'limit_reached':
    case 'rate_limit':
      return 429;
    case 'not_configured':
    case 'overloaded':
      return 503;
    // The server's key or the upstream API failed: never 401, which clients read as "signed out".
    case 'auth':
    case 'max_tokens':
    case 'invalid_response':
    case 'api_error':
    default:
      return 502;
  }
}

/** The configured estimator, or null when AI is not configured. */
export function createMealEstimator(config: Config, client?: AnthropicClient | null): MealEstimator | null {
  if (client === null) return null;
  if (client) return new AnthropicMealEstimator(client);
  if (config.ai.provider !== 'anthropic' || !config.ai.apiKey) return null;
  return new AnthropicMealEstimator(new Anthropic({ apiKey: config.ai.apiKey, timeout: 120_000, maxRetries: 2 }));
}
