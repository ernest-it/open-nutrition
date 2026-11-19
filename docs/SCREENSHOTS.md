# Screenshots

Demo data: about two weeks of meals, two months of weigh-ins, targets, saved meals and a recipe, created by [`scripts/seed-demo.ts`](../scripts/seed-demo.ts). Android shots are from an Android 16 emulator (Pixel 7); web shots are 1280 × 800. No AI key was configured, so AI meal logging is shown as not set up.

## Mobile app (Android)

### Logging

| Today | Add food | Search the food database | Pick a serving |
|---|---|---|---|
| ![Today](screenshots/android/02-today.png) | ![Add sheet](screenshots/android/04-add-sheet.png) | ![Food search](screenshots/android/05-food-search.png) | ![Food detail](screenshots/android/06-food-detail.png) |

| Diary | Barcode scanner |
|---|---|
| ![Diary](screenshots/android/03-diary.png) | ![Barcode scanner](screenshots/android/07-barcode.png) |

### Progress

| Nutrients report | Weight & body | Foods & recipes |
|---|---|---|
| ![Nutrients](screenshots/android/08-nutrients.png) | ![Weight and body](screenshots/android/09-body.png) | ![Foods](screenshots/android/10-foods.png) |

### Settings

| Connect to your server | Settings |
|---|---|
| ![Connect](screenshots/android/01-connect.png) | ![Settings](screenshots/android/11-settings.png) |

### Dark mode

| Today | Nutrients | Weight & body |
|---|---|---|
| ![Dark today](screenshots/android/dark-today.png) | ![Dark nutrients](screenshots/android/dark-nutrients.png) | ![Dark body](screenshots/android/dark-body.png) |

### Landscape

The app rotates; in landscape it switches to a navigation rail and a two-pane Today screen.

![Landscape today](screenshots/android/landscape-today.png)

## Web UI

Served by the same container at `http://<host>:8080`.

**Today**
![Web today](screenshots/web/02-today.png)

**Diary with calendar**
![Web diary](screenshots/web/03-diary.png)

**Add food: search** (your own foods first, then the bundled USDA database)
![Web add food search](screenshots/web/04-add-food-search.png)

**Add food: barcode** (looked up in Open Food Facts)
![Web barcode](screenshots/web/05-barcode.png)

**Nutrients** (weekly average against targets; tap a nutrient for its top sources)
![Web nutrients](screenshots/web/06-nutrients.png)

**Weight & body**
![Web body](screenshots/web/07-body.png)

**Foods**
![Web foods](screenshots/web/08-foods.png)

**Settings: profile & targets**
![Web settings](screenshots/web/09-settings.png)

**Sign in**
![Web sign in](screenshots/web/01-sign-in.png)

**Dark mode**
![Web dark today](screenshots/web/dark-today.png)
![Web dark nutrients](screenshots/web/dark-nutrients.png)
![Web dark body](screenshots/web/dark-body.png)

**Phone width** (390 px)

| Today | Add food |
|---|---|
| <img src="screenshots/web/phone-today.png" width="300" alt="Web today at phone width"> | <img src="screenshots/web/phone-add-food.png" width="300" alt="Web add food at phone width"> |
