# Bundled food database

`build-foods-db.mjs` builds `apps/mobile/assets/foods.db`, the offline USDA food database bundled with the app
and read by the server (`FOOD_DB_PATH`).

```sh
node data/build-foods-db.mjs
```

It needs Node 24 or newer (it uses the built-in `node:sqlite`, with FTS5) and no npm packages. To unzip it uses
`unzip`, `tar` (bsdtar, which ships with Windows 10+ and macOS) or PowerShell, whichever is available. The USDA zips
are downloaded once into `data/.cache/`, which is gitignored. Delete that folder to download them again.

Options:

- `--foundation=YYYY-MM-DD` / `--sr=YYYY-MM` pick other releases. The defaults are pinned in the script.
- `--out=path` writes the database somewhere else.
- `--built-at=ISO` (or `SOURCE_DATE_EPOCH`) fixes `meta.built_at`, which makes the output byte-for-byte
  reproducible. Without it, only that one value changes between runs.
- `--no-check` skips the sample searches that are printed at the end.

## Sources

[USDA FoodData Central](https://fdc.nal.usda.gov/download-datasets) CSV releases. Both are CC0 / US public domain.
Attribution: "USDA, Agricultural Research Service. FoodData Central."

| Dataset | Release | Why |
|---|---|---|
| Foundation Foods | 2026-04-30 | The 2026-10-29 CSV zip has no `food.csv`, `food_nutrient.csv` or `food_portion.csv`. |
| SR Legacy | 2018-04 | Final release. This dataset is frozen. |

When you bump a release, check that its zip contains `food.csv`, `food_nutrient.csv`, `food_portion.csv`,
`nutrient.csv`, `measure_unit.csv`, `food_category.csv` and `foundation_food.csv` / `sr_legacy_food.csv`.

## What the script does

- **Foods.** It keeps only the current records listed in `foundation_food.csv` / `sr_legacy_food.csv`. `food.csv`
  also lists superseded Foundation versions and sample records, and those are dropped. Names are the USDA
  descriptions, and the category comes from `food_category`.
- **Nutrients.** Values are stored per 100 g and keyed by USDA nutrient number. Only the keys listed in
  `packages/shared/src/nutrients.ts` are kept. Values are rounded to 3 significant figures, or to a whole number
  at 100 and above. Missing values are left out.
  - Energy uses 208. When 208 is missing, it uses Atwater specific (958), then Atwater general (957). If those are
    missing too, it computes 4/4/9/7 from the macros, but only when protein, fat and carbs are all present or the
    food is at least 80 % fat.
  - Fat falls back to 298, carbs to 205.2 and sugars to 269.3.
  - Folate DFE (435) falls back to food folate + 1.7 × folic acid, or to total folate when there is no folic acid.
- **Foods without energy are skipped.** These are about 60 partial Foundation records, such as the
  "(0% moisture)" beans. A food without energy would log 0 kcal. SR Legacy covers the same foods.
- **Servings** come from `food_portion` and `measure_unit`.
  - SR Legacy puts the unit text in `modifier` (for example "cup, chopped").
  - Foundation uses `measure_unit` plus `modifier` / `portion_description`.
  - Scalable measures are normalised to 1 unit: "3 oz = 85 g" becomes "1 oz = 28.3 g". Other amounts are kept
    as they are, for example "0.5 fillet".
  - Paired raw/cooked weight rows are dropped. Labels are deduped case-insensitively, with at most 10 per food.
  - The app adds "100 g" itself.

Schema and search SQL: see the "Bundled food database" section of the build contract. The script runs the same
search SQL for its sample searches.
