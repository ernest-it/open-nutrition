# Notices

Required Notice: Copyright (c) 2026 ernest-it

Open Nutrition is licensed under the PolyForm Noncommercial License 1.0.0 (see
[LICENSE](LICENSE) and the plain-English summary in [LICENSING.md](LICENSING.md)).

## Third-party software

Open Nutrition is built on open-source libraries that stay under their own
licenses. Each build generates the full list of production dependencies, with
their license texts:

- The **server and web UI** list is served at `/third-party-notices.txt` on every
  server and included in the Docker image (`npm run notices`).
- For the **mobile app**, run `node scripts/third-party-notices.mjs apps/mobile`.

At the time of writing, those dependencies use the following licenses, all of
which allow inclusion in this project with their notices kept:
- MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD, BlueOak-1.0.0 and Unlicense
- MPL-2.0 (lightningcss, a build tool)
- Python-2.0 (argparse)
- CC-BY-4.0 (caniuse-lite browser data)
- node-forge, under the BSD-3-Clause option of its dual license

Placeholder icons and splash images in `apps/mobile/assets` come from the Expo
project template (MIT, © 650 Industries, Inc.).

## Food data

**USDA FoodData Central.** The bundled food database is derived from USDA FoodData Central
(Foundation Foods and SR Legacy). Food data from U.S. Department of Agriculture, Agricultural
Research Service, FoodData Central, https://fdc.nal.usda.gov/. The data is in the public domain
(CC0 1.0).

**Open Food Facts.** Barcode product data comes from Open Food Facts (https://openfoodfacts.org),
made available under the Open Database License (ODbL) 1.0; individual contents are under the
Database Contents License (DbCL). Product images, where shown, are under CC BY-SA. Fetched products
are cached in a table kept separate from user data (`off_cache`).

## Trademarks

All product and company names are trademarks of their owners. Open Nutrition is an independent
project and is not affiliated with or endorsed by Anthropic, the USDA or Open Food Facts. "Claude"
is a trademark of Anthropic, used only to name the optional AI provider.
