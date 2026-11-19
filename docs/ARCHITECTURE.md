# Architecture

```
┌────────────────────┐        ┌────────────────────┐
│  Mobile app (Expo) │        │  Web UI (React)    │
│  iOS + Android     │        │  served by server  │
│  ── main frontend  │        │                    │
│  NutritionStore    │        │  NutritionStore    │
│  + SQLite snapshot │        │  + IndexedDB       │
│  + bundled foods.db│        │                    │
└─────────┬──────────┘        └─────────┬──────────┘
          │  HTTPS  POST /api/v1/sync   │
          └──────────────┬──────────────┘
                ┌────────▼─────────┐
                │ Server (Fastify) │  one container, port 8080
                │  auth · sync     │
                │  food search     │   read-only foods.db (USDA)
                │  OFF proxy+cache │
                │  AI estimate     │──► Anthropic API (optional)
                │  static web UI   │
                └────────┬─────────┘
                         │
                 SQLite (WAL) in /data
```

This describes the intended v0.1 design (see [ROADMAP.md](ROADMAP.md)).

## Repository layout

| Path | What |
|---|---|
| `packages/shared` | **Domain core**, used by every other part: zod schemas (`schema.ts`), the nutrient list (`nutrients.ts`), nutrition maths and targets (`calc.ts`), the AI request/response contract (`ai.ts`), Open Food Facts mapping (`off.ts`), food database helpers (`foodDb.ts`), diary CSV export (`csv.ts`), and `NutritionStore` (the offline-first client store and sync engine). |
| `apps/server` | Fastify + better-sqlite3. Bundled into one `dist/index.js` by esbuild. Auth, sync, bundled-food search, the Open Food Facts proxy and cache, and the AI estimate endpoint. |
| `apps/web` | React + Vite. Built to static files that the server serves. |
| `apps/mobile` | Expo / React Native app. Kept outside the npm workspaces so that its pinned React/RN versions stay isolated. Metro resolves `@open-nutrition/shared` from source. Ships `assets/foods.db`. |
| `data/` | Build script for the bundled USDA food database (`build-foods-db.mjs`). |
| `deploy/` | Kubernetes manifests and the Proxmox LXC installer. |

**Key design choice: logic lives in `shared`, not in the frontends.** The web and mobile apps use the same store and the same domain actions (`logFood`, `quickAdd`, `logRecipe`, `copyMeal`, `saveMealFromEntries`, `setTargets`, …). Daily totals, reports and charts are computed on the client from local data. As a result:

- the server stays thin, and
- the app works fully offline, including a **local-only mode with no server at all**.

## Data model

Units: food mass in **grams**, body weight in **kg**, lengths in **cm**, water in **ml**, energy in **kcal**. Calendar days are local `YYYY-MM-DD` strings. Unit conversion happens only in the UI.

Every synced row has `id, createdAt, updatedAt, deletedAt` (epoch ms; deletes are soft). Columns whose type is an object, array, record or unknown are stored as JSON text in SQL.

```
foods ──< diaryEntries >── recipes
  │             │
  │             └── aiEstimates (aiEstimateId)
  └──< savedMeals.items / recipes.ingredients (snapshots)
measurements · targets · settings
```

| Collection | Contents |
|---|---|
| `foods` | The user's custom foods and cached copies of foods they have logged. `name`, `brand`, `barcode`, `source` (`usda` \| `off` \| `custom` \| `ai`), `sourceId` (FDC id, or barcode for Open Food Facts), `servings[]` (label + grams), `nutrients` per 100 g, `favorite` |
| `diaryEntries` | `date`, `meal` (breakfast/lunch/dinner/snack), `foodId` (null for quick add), `recipeId`, `name`, `source` (`usda`, `off`, `custom`, `ai`, `quick`, `recipe`), `grams`, `servingLabel`, `quantity`, `nutrients` (**totals**, snapshotted so editing a food never rewrites history), `aiEstimateId`, `position`, `loggedAt` |
| `recipes` | `ingredients[]` (food, grams, per-100 g nutrients snapshot), `portions`, optional `cookedGrams`, `notes`, `favorite`. Nutrients are computed from the ingredients |
| `savedMeals` | A named group of items you can log in one tap (for example "usual breakfast") |
| `measurements` | `kind` (`body_weight`, `body_fat`, `water`, circumferences), `value`, `takenAt`. Water is one row per drink; the day's total is the sum |
| `targets` | Dated rows (`effectiveFrom`) with `nutrients` and `waterMl`. Changing a target adds a row, so past days keep the targets they had |
| `aiEstimates` | Date, meal, SHA-256 of the resized photo (the photo itself is never synced), description, model, the raw structured `response`, what the user `accepted`, token counts |
| `settings` | Per-user key/value, JSON-encoded. Keys: `profile` (sex, birth year, height, activity, goal rate, protein g/kg, macro split) and `prefs` (units, AI on/off, model, effort). **API keys are never a setting** |

### Nutrient keys

Every nutrient amount in the app is a map keyed by the **USDA nutrient number**: `"208"` is calories (kcal), `"203"` protein (g), `"205"` carbohydrates, `"204"` fat, `"291"` fibre, `"307"` sodium (mg), `"401"` vitamin C, and so on. Every source (USDA, Open Food Facts, AI, manual entry) maps onto this one list in the units declared in `nutrients.ts`.

The v1 "core" nutrients, shown by default, are: calories, protein, carbohydrates, fat, fibre, sugars, added sugars, saturated fat, sodium, potassium, calcium, iron, magnesium, zinc, and vitamins A, C, D, E, K, B12 and folate. The rest are stored but hidden unless enabled. Nutrients where lower is better (sodium, sugars, saturated fat) are flagged as limits.

### Targets

`computeTargets` builds the starting targets from the profile: Mifflin-St Jeor BMR × activity factor, adjusted by the goal rate (7700 kcal per kg, with a safety floor); macros from a percentage split or protein g/kg; micronutrients from US DRI defaults for age and sex (with ceilings for sodium, added sugar and saturated fat). Every number can be edited.

## Food data

Three kinds of food reach the diary:

1. **Bundled USDA foods** (`apps/mobile/assets/foods.db`, built from USDA FoodData Central Foundation + SR Legacy by `data/build-foods-db.mjs`). A read-only SQLite file with a `foods` table (per-100 g nutrients and portions as JSON), an FTS5 index (`foods_fts`, porter stemming) and a `meta` table (source, release dates, attribution). Search is a bm25-ranked FTS5 query. The app queries it on the device; the server reads the same file from `FOOD_DB_PATH`. Ids are `usda:<fdcId>`. These foods are **never synced**. Logging one copies it into `foods` under a fresh id (`source: 'usda'`, `sourceId: fdcId`, deduplicated on source + sourceId).
2. **Open Food Facts products** (barcode scan). The server proxies lookups with a custom User-Agent and keeps results in an `off_cache` table, **separate from user data**. When USDA Branded fallback is enabled (`USDA_API_KEY`), unknown barcodes are looked up there. A product the user logs is copied into `foods` like any other food. Images are not stored.
3. **Custom foods and AI foods**, created by the user and synced like everything else.

See [LICENSING.md](../LICENSING.md#data-licenses) for why OFF data stays in its own cache.

## AI meal logging

Claude estimates items and grams; nutrients come from the food database where a good match exists. The phone can call Anthropic directly (own key, local-only) or ask the server (server key). See [AI_MEAL_LOGGING.md](AI_MEAL_LOGGING.md).

## Sync protocol (v1)

There is a single endpoint. Third-party clients can implement it easily. It is generic over the collections registered in `COLLECTIONS`.

```
POST /api/v1/sync
Authorization: Bearer <token>
{ "since": <number>, "changes": { "<collection>": [ <full row>, ... ], ... } }

200 OK
{ "rev": <number>, "more": <bool>,
  "changes": { "<collection>": [ <row>, ... ] },
  "rejected": [ { "collection", "id", "error" } ] }
```

**Client side:**
1. Keep `rev` (initially `0`) and the set of locally modified row IDs (the "pending" rows).
2. Push all pending rows as **complete rows**, not patches.
3. Apply the returned rows, but skip any row that was edited locally again while the request was in flight. That row stays pending and goes up on the next sync.
4. Store the returned `rev`. If `more` is true, call again with `changes: {}` until it is false.

**Server side** (one transaction per request):
1. Validate each row against the zod schema. Invalid rows are reported in `rejected`; they never fail the whole request.
2. Resolve conflicts with **last-write-wins per row** on `updatedAt`. Ties go to the incoming row. Rows with `updatedAt` more than 24 h in the future are rejected, to limit the damage from a broken clock.
3. Give every written row a new value from a global, monotonically increasing `rev`.
4. Return the user's rows with `rev > since`, ordered by `rev`, in pages of 5,000.

**Deletes** are soft (`deletedAt`), so they propagate to every device.

**Why per-row LWW and not CRDTs?** Nearly all concurrent edits touch different rows: one diary entry per tap. The few that collide are fine with "last edit wins". A field-level merge can be added later without changing the protocol.

## REST API

All paths are under `/api/v1`.

| Method & path | Auth | Purpose |
|---|---|---|
| `GET /health` | – | Liveness/readiness |
| `GET /server-info` | – | `{name, version, apiVersion, registrationOpen, serverId}`. The app uses it to recognise a server |
| `POST /auth/register` | – | `{username, password, deviceName?}` → `{token, user}`. The first user becomes admin; after that, registration needs `ALLOW_REGISTRATION=true` |
| `POST /auth/login` | – | Same shape. Rate-limited per IP |
| `POST /auth/logout` | ✓ | Revokes the current token |
| `POST /auth/password` | ✓ | Changes the password and revokes the user's other sessions |
| `GET /me`, `DELETE /me` `{password}` | ✓ | Profile; delete the account and all its data (requires the password) |
| `GET /sessions`, `DELETE /sessions/:id` | ✓ | List and revoke devices |
| `POST /tokens` | ✓ | Create a named long-lived API token |
| `POST /sync` | ✓ | See above |
| `GET /foods/search?q=&limit=` | ✓ | Search the bundled USDA foods → `{ foods }` |
| `GET /foods/:id` | ✓ | One bundled food (`usda:<fdcId>`) |
| `GET /foods/barcode/:code` | ✓ | Open Food Facts lookup (cached), optional USDA Branded fallback → `{ food, source }` |
| `GET /ai/status` | ✓ | `{ enabled, models, defaultModel, monthlyLimit, usedThisMonth }` |
| `POST /ai/estimate` | ✓ | `{ imageBase64?, mediaType?, description?, model?, effort? }` → estimate, token counts and cost. `503` if AI is not configured |
| `GET /export/json` | ✓ | Full backup; re-importable through `/sync` |

**Authentication.** Opaque bearer tokens (256-bit). Only their SHA-256 hash is stored. Passwords are hashed with scrypt (N=16384, r=8, p=1).

## Testing

- **`npm test`** runs `shared` unit tests (nutrient maths, targets, store flows, OFF mapping, AI request/response parsing) and `server` integration tests (auth, registration lock, two-device sync with conflicts and deletes, user isolation and validation, food search, paginated pull).
- **Web UI:** driven end to end with Playwright during development.
- **Mobile:** type-checked; `npm run export:android` verifies the Metro bundle.
