# Licensing in plain English

Open Nutrition is **source-available**, not open source. Anyone can read, run, change and share the code for **non-commercial** purposes. **Commercial use needs a separate license** from the copyright holder.

The legal terms are the [PolyForm Noncommercial License 1.0.0](LICENSE). This page is a summary to help you; if the two ever disagree, the license wins. Food data has its own licenses; see [Data licenses](#data-licenses) below.

## You may, for free

- ✅ **Use the app and the web UI** to track your own nutrition.
- ✅ **Self-host the server** for yourself, your family or friends, and sync your devices with it.
- ✅ **Read, study and change the code**, e.g. fix a bug, add a feature or adapt it to your setup.
- ✅ **Share copies, including your changed version**, as long as they're non-commercial. Anyone who gets a copy from you must also get:
  - the license terms (or the link to them), and
  - the `Required Notice:` line from the top of [LICENSE](LICENSE).
- ✅ **Use it in charities, schools, universities, public research and government**, whatever their funding.

## You may not, without a commercial license

- ❌ Sell the software or a modified version of it, or charge for access to it.
- ❌ Run it as a paid service, e.g. hosted sync that people pay for.
- ❌ Use it to run or support a business: a dietitian or nutrition-coaching practice, a gym, a company wellness programme, a product you sell.
- ❌ Put it, or something built from it, in an app store for money, with ads, or with in-app purchases.

The official hosted sync service is the copyright holder's commercial offering, and it's how the project is funded.

## Unsure?

Some situations are grey areas. Examples:
- a public server funded by donations
- a club or clinic that charges membership
- a creator showing the app in monetised videos

**Ask first** by opening an issue titled "Licensing question". A written yes from the copyright holder is the safe way to proceed.

## Commercial licenses

To use Open Nutrition commercially, open an issue titled "Commercial license" and the copyright holder will get back to you.

## Contributions

Contributions are welcome under the contributor agreement in [CONTRIBUTING.md](CONTRIBUTING.md). It lets the project ship your change in every edition, including the paid one, while you keep the copyright in your work.

## Data licenses

The code license above covers the code only. Food data comes from other projects, with their own terms.

### USDA FoodData Central: public domain (CC0)

The bundled generic food database (Foundation Foods and SR Legacy) comes from [USDA FoodData Central](https://fdc.nal.usda.gov/), published under CC0 / US public domain. There are no restrictions, including for paid hosting. We credit it anyway, as USDA requests.

### Open Food Facts: ODbL, DbCL and CC BY-SA

Barcode lookups use [Open Food Facts](https://openfoodfacts.org/):

- The **database** is under the [Open Database License (ODbL) 1.0](https://opendatacommons.org/licenses/odbl/1-0/), the **individual contents** under the Database Contents License (DbCL), and **product images** under CC BY-SA.
- **Commercial use is allowed**, including paid hosting.
- **Attribution:** the app and website credit Open Food Facts (Settings → About).
- **Share-alike applies to the Open Food Facts portion only.** Products fetched by barcode are kept in a separate cache (`off_cache`), apart from your own data and the USDA data. Any obligation to offer a derived Open Food Facts database under ODbL therefore covers only that cache. Your diary, custom foods and the app's code are not affected.
- **Images are not stored.** Nutrition numbers need no image.
- **Custom User-Agent:** every API call identifies this app, as Open Food Facts asks.
- The app offers to contribute products you create back to Open Food Facts.

Your own custom foods belong to you and sync like the rest of your data. This section is a summary, not legal advice.

## Third-party components

Open Nutrition is built on libraries with their own permissive licenses: MIT, ISC, BSD, Apache-2.0, BlueOak-1.0.0 and others. Those libraries stay under their own licenses. See [NOTICE.md](NOTICE.md).
