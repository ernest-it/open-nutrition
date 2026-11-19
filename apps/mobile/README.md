# Open Nutrition: mobile app

The main frontend, built with Expo (SDK 58) / React Native. It uses the same offline-first `NutritionStore` as the web UI, through `@open-nutrition/shared`.

```bash
npm install
npx expo start            # Expo Go on a phone, or `a` / `i` for an emulator/simulator
npm run typecheck
npm run export:android    # verifies the production JS bundle
```

- **First launch:** connect to a server URL (LAN `http://` is allowed), or choose **local-only** mode.
- **Storage:**
  - Data is kept in on-device SQLite (`expo-sqlite/kv-store`).
  - The account token is kept in the OS keychain (`expo-secure-store`).
- **Food database:** `assets/foods.db` (USDA FoodData Central, built by `data/build-foods-db.mjs`) is bundled and opened read-only with expo-sqlite (`SQLiteProvider assetSource`), so search works offline. Open Food Facts lookups are cached in a separate, unsynced table.
- **AI key (local-only mode):** an Anthropic key the user enters is kept only in the OS keychain (`expo-secure-store`, entry `on.anthropicApiKey`) and sent only to api.anthropic.com. It never enters synced settings or the data snapshot.
- **Goal weight:** synced setting `goalWeightKg` (number, kg), shared with the web app.
- **Layouts:** `src/layout.ts` defines the breakpoints (compact < 600, medium 600–899, expanded ≥ 900 dp). Medium and up use two columns; expanded screens and short landscape phones use a side rail instead of the bottom tabs.
- **Sync triggers:** two seconds after a change, every minute, and whenever the app returns to the foreground.

**Release builds** come from `.github/workflows/release.yml` on every `v*` tag, attached to the GitHub release:

- **Android:** a release APK, signed with the release key from the `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD` and `ANDROID_KEY_ALIAS` repository secrets. Keep that key: Android only installs updates signed with the same key.
- **iOS:** an unsigned `.ipa` (re-sign it with AltStore, Sideloadly or your own Apple developer account) and a simulator build. The workflow also launches the app on the smallest and largest iPhone simulators and keeps screenshots.

Run the workflow by hand (Actions → Release → Run workflow) to build and test without publishing. Bump `version`, `android.versionCode` and `ios.buildNumber` in `app.json` for each release.

**Building on Windows:** the native Android build exceeds the 260-character path limit unless long paths are enabled. Build in WSL/Linux, or enable long paths.

**Expo changes quickly.** Use `npx expo install <pkg>` so versions match the SDK, and check the docs for the SDK version in `package.json` (see `AGENTS.md`).
