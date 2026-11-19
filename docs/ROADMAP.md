# Roadmap

The v0.1 feature set follows phases 0–5 below. Phases 6–7 and the "Later" list are not part of v0.1. Effort figures are rough.

## Build order

| Phase | Deliverable | Rough effort |
|---|---|---|
| **0. Scaffold** | Copy the Open Workouts layout, rename, strip the workout-specific code. CI, Docker and release workflows pass. | ½–1 day |
| **1. Core logging** | Bundled USDA database, search, the diary with meal sections, the Today screen with calorie ring and macro bars, quick add, custom foods, targets onboarding. Local-only mode works. | 1–2 weeks |
| **2. Sync + server + web** | New collections in sync, the server and the web UI (diary, reports, charts). Same account and token machinery. | 3–5 days |
| **3. Barcode** | `expo-camera` scanning, Open Food Facts lookup with cache and attribution, "product not found → create it (and offer to contribute it)". | 3–4 days |
| **4. Weight & nutrients** | Weight trend chart, the measurements screen, the full nutrient report with "top foods for this nutrient". | 3–5 days |
| **5. AI logging** | Photo or description → Claude → review screen. Server-key and on-device-key modes. Cost notice. A small eval set of 20–30 weighed meals to compare models and effort. See [AI_MEAL_LOGGING.md](AI_MEAL_LOGGING.md). | 1 week |
| **6. Quality** | Recents and favourites, copy meal/day, saved meals, recipes. Polish on small phones, large text, dark mode and tablets. A possible importer for other apps' data exports, if a suitable open export format exists. | 1–2 weeks |
| **7. Release** | Signed APK (new keystore, backed up), iOS builds, Docker `latest`, screenshots, README. | 1 day |

**Smallest useful version:** phases 0, 1, 3 and 5 in local-only mode with your own key on the phone. Add the server afterwards.

## Later

- Adaptive TDEE that learns from your weight trend and intake
- Apple Health / Health Connect sync
- Water reminders
- Intermittent fasting timer
- Blood glucose logging
- Meal planning
- MCP tools for your own assistant ("how much protein did I average this month?")
- Weekly AI report (reusing the Open Workouts insights pattern)
- Shared accounts with Open Workouts (one server and login for training and nutrition)

## Open questions and chosen defaults

| # | Question | Default for now |
|---|---|---|
| 1 | **Name** | "Open Nutrition", app id `org.opennutrition.app`. Still check app stores, GitHub and trademarks before release |
| 2 | **Region** | US first: USDA (generic + Branded fallback) and Open Food Facts. Other regions rely mainly on Open Food Facts |
| 3 | **v1 micronutrients** | The core set: fibre, sugars, added sugars, saturated fat, sodium, potassium, calcium, iron, magnesium, zinc, vitamins A, C, D, E, K, B12 and folate. Others are stored and can be enabled later |
| 4 | **Hosted tier** | Option C: AI included with a monthly per-user cap (`AI_MONTHLY_LIMIT` on the server) |
| 5 | **Accounts shared with Open Workouts?** | Separate accounts for now; shared sync is a possible later feature |

Food-data licensing (especially the Open Food Facts share-alike setup) should be reviewed by a lawyer before launching a paid hosted tier. See [LICENSING.md](../LICENSING.md#data-licenses).
