# AI meal logging

Optional. Take a photo of a meal and/or describe it, and Claude estimates what is on the plate. **You always review the result before anything is saved.** AI is off until you turn it on in Settings, and you can turn it off again.

> This is the intended v0.1 design (phase 5 in [ROADMAP.md](ROADMAP.md)). Costs below are estimates until measured on real usage.

## The flow

1. **Add → Photo / describe.** Take a photo, pick one from the gallery, type a description, or use both. For example: a photo plus "chicken burrito bowl, half the rice, no sour cream".
2. **Send to Claude** (via your server, or directly from the phone; see [key options](#where-the-api-key-lives)). The reply is structured JSON: the items found, an estimated weight in grams for each, a USDA-style search term, nutrients, a confidence level and notes.
3. **Review screen (always shown, never auto-saved).** Each item shows grams and kcal. You can delete wrong items, swap an item for a database food, adjust portions, choose the meal, then tap **Add to diary**.
4. **Save** each item as a diary entry with `source: 'ai'` (or the database source if matched). The raw estimate is stored in `aiEstimates` (without the photo) so accuracy can be reviewed later.

The **text description wins over the photo.** You know it was half the rice.

## Accuracy: Claude estimates grams, the database supplies nutrients

Claude is good at identifying foods and estimating portions. A food database is better at per-gram nutrient values, especially micronutrients. So:

1. Claude returns each item with a name, a USDA-style search term (for example "rice, white, cooked") and a weight in grams.
2. The app searches the bundled USDA database for that term and uses **database nutrients × grams**.
3. If there is no good match, it falls back to **Claude's own nutrient estimate** for that item and marks it "AI estimate".

Macros are therefore as good as the portion estimate, and micronutrients come from real data rather than guesses. Mixed dishes remain the weak spot; the review screen exists for that reason.

## Models and rough cost

| Model | Price (per million tokens, in / out) | Use |
|---|---|---|
| `claude-opus-5-5` (default) | $4 / $20 | Most accurate |
| `claude-sonnet-5-5` | see the model list in the app | Middle option |
| `claude-haiku-5-5` | $0.10 / $0.50 | "Cheap" option in Settings |

A typical estimate is one photo resized to about 1024 px (roughly 1.5k tokens), a fixed system prompt (1–2k tokens, mostly served from the prompt cache) and 1–2k tokens of output. That is about **2–5 cents on Opus** and a fraction of a cent on Haiku. The app shows an estimated cost before you send. Effort defaults to `low`; raise it only if the evals below show it helps.

Implementation notes: structured output with a JSON schema (no free-text parsing), the stable system prompt behind `cache_control`, `stop_reason` checked so refusals and truncation produce a clear message instead of a bad result.

## Where the API key lives

| Option | Key lives | Visible to | Use when |
|---|---|---|---|
| **A. Server key** (recommended for self-hosting) | `LLM_API_KEY` in the server environment | Only whoever runs the server | You run a server. The phone and web UI never hold the key; they ask your server. `AI_MONTHLY_LIMIT` caps each user |
| **B. Your own key on the device** | The phone's Keychain/Keystore via `expo-secure-store` | Only that phone; sent only to `api.anthropic.com` | Local-only mode with no server |
| **C. Hosted tier** | The provider's server | The provider | The paid hosted tier includes AI with a monthly cap per user, so users never handle keys |

Rules the app follows:

- The key is never in synced data, backups, logs, crash reports or the web UI's storage. The web UI uses option A only.
- Settings shows the key masked (`sk-ant-…a1b2`) with a **Remove key** button, plus a notice: *"Your key is stored only on this device and sent only to Anthropic. Set a spend limit in the Claude Console."*
- A hosted service never stores other people's keys.

**Recommendation:** create a **dedicated key** in a **Claude Console workspace with a monthly spend limit**. A leaked key then costs little and can be revoked without affecting anything else. See also [SECURITY.md](../SECURITY.md).

## Privacy

- Meal photos and descriptions are sent to Anthropic when you run an estimate. Nothing is sent while AI is off.
- Photos are resized on the phone and are not synced; only a hash is kept in `aiEstimates`.
- Anthropic's own data-use terms apply to what is sent through your key.

## Import from a restaurant's nutrition page

Foods → **Import from a restaurant** (web: also in Add food). The user pastes the address of a restaurant's own nutrition page or nutrition PDF, or pastes the page's text. Claude transcribes the menu items (name, serving, serving weight, and per-serving calories, fat, saturated fat, sodium, carbohydrates, fibre, sugars, added sugars and protein as printed) and the user ticks which ones to save. Saved items become ordinary custom foods with the restaurant as the brand; nothing else is stored.

- **Same availability as AI logging:** signed in to a server with AI set up (the server fetches the page and calls Claude; one request counts against the AI limits), or local-only mode with your own key (the phone fetches the page and calls Anthropic directly).
- **Transcription, not estimation:** the prompt (`MENU_IMPORT_SYSTEM_PROMPT` in `packages/shared/src/menuImport.ts`) says to copy printed values and use null for anything not listed. The only estimated value is a serving's weight when the page gives none; such servings are labelled "(weight estimated)".
- **One page, on request:** each import is a single read of one page the user chose, for that user only. Nothing is crawled, cached or shared between users, and no restaurant data ships with the app.
- **Server safety:** the server only opens public http(s) addresses on ports 80/443. Every resolved IP must be public, checked inside the socket's own DNS lookup (so DNS rebinding cannot reach the LAN, localhost or cloud metadata), and redirects are re-checked (`apps/server/src/pageFetch.ts`). Pages are limited to 20 MB and 15 s.
- **Limits:** pages that render their menu with JavaScript have almost no text in their HTML. The app says so and asks for the PDF link or pasted text. Very long pages (over 400,000 characters) must be pasted in parts. The answer is streamed on the server, so large menus do not time out.

## Evaluation plan

Before trusting any model or effort setting, build a small eval set:

1. Collect **20–30 meals** you have weighed on a kitchen scale, with photos, covering simple plates, mixed dishes and packaged food. Record each item's true grams and kcal, and (from the database) protein, carbs and fat.
2. Run each photo (with and without a short description) through each candidate: Opus, Sonnet and Haiku at `low` and `medium` effort.
3. Compare per-meal and per-item error: gram error, kcal error, macro error, item-identification misses, and how often the database match was used versus the AI fallback.
4. Record cost and latency per run, then pick the default model and effort from the results.

Keep the eval set and results out of the public repo if the photos are personal.

## Where the numbers come from

Every item on the review screen says where its numbers come from:

| Shown as | Meaning |
|---|---|
| **USDA match** | A generic food (a banana, rice, chicken breast). Claude names the food and estimates the amount; the nutrient values are the USDA database's, not Claude's. |
| **Published numbers** with a link | A brand-name product or a restaurant item. Claude searched the web, copied the published nutrition facts, and the link opens the page it used. |
| **AI estimate** | Nothing better was found. The numbers are Claude's own estimate. |

A source link is only shown when it is a page the web search actually returned for that request. A link Claude could not have seen is dropped and the item is shown as an estimate.

### Web search

- **Default:** Claude searches only when a meal contains a brand-name or restaurant item, at most 3 searches per meal.
- **Always search the web** (Settings → AI): Claude searches for every meal, at most 5 searches. Slower, and it costs more.
- **Cost:** Anthropic charges $10 per 1,000 searches (1¢ each), and the text of the results is billed as input tokens, so a meal with a looked-up item costs noticeably more than one without.
- **Server owners** can turn web search off for everyone with `AI_WEB_SEARCH=off`, or lower the per-meal cap with `AI_MAX_SEARCHES`.
- If the Anthropic account has web search disabled, the estimate is made without it and says so.

### Uncertain portions

When the amount is the main uncertainty, the item shows a few amounts to choose from ("half a cup", "1 cup"). Tapping one rescales the item on the device; it does not make another AI request.

## Spending limits

Whoever holds the API key pays for every request, so the server limits them. These are on by default:

| Limit | Default | Setting |
|---|---|---|
| Whole server, per month | $25 | `AI_MONTHLY_BUDGET_USD` |
| Per user, per month | 150 requests | `AI_MONTHLY_LIMIT` |
| Per user, per day | 40 requests | `AI_DAILY_LIMIT` |
| Per user, per hour (attempts, including failed ones) | 30 | fixed |
| Per user, at the same time | 1 request | fixed |
| Whole server, at the same time | 4 requests | `AI_MAX_CONCURRENT` |
| Web searches per estimate | 3 (5 with "always") | `AI_MAX_SEARCHES` |
| Output per estimate / per menu import | 16,000 / 32,000 tokens | fixed |

- **The budget is checked before each request** against what has been spent this month plus the worst case of every request still running. When it is reached, AI stops for everyone until the 1st of the next month. Admins see the amount spent in Settings → AI.
- **One tap is one request.** Neither the apps nor the server ever resend a failed request; the error is shown and the user decides. The only exceptions are fixed in code and tested: one retry without web search when Anthropic rejects the request outright (a rejected request is not billed), and one continuation when Anthropic pauses a long search. An estimate can never make more than 3 requests.
- **Failures are counted honestly.** A request Anthropic rejected is given back to the user. A request that timed out stays counted, because it may have been billed. An answer that came back unusable has its cost added to the month's spending.
- **Only signed-in users can use AI**, and registration is closed by default after the first account.
- The budget is an estimate from token counts and list prices. For a hard stop on Anthropic's side as well, use a dedicated API key in a Console workspace with its own spend limit.

In local-only mode the phone calls Anthropic with the user's own key, so the server limits do not apply; the one-request rule, the search cap and the output caps still do.
