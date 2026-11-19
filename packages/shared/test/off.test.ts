import { describe, expect, it } from 'vitest';
import { N, OFF_USER_AGENT, isValidBarcode, mapOffProduct, offProductUrl, parseServingGrams, upcEToUpcA } from '../src';

// Trimmed from a real API v2 response (values as OFF serves them: per 100 g, in grams).
const nutella = {
  code: '3017620422003',
  status: 1,
  status_verbose: 'product found',
  product: {
    code: '3017620422003',
    product_name: 'Nutella',
    product_name_en: 'Nutella hazelnut spread',
    brands: 'Nutella,Ferrero',
    quantity: '400 g',
    serving_size: '15 g',
    serving_quantity: 15,
    nutrition_data_per: '100g',
    nutriments: {
      'energy-kj_100g': 2252,
      'energy-kcal_100g': 539,
      energy_100g: 2252,
      energy_unit: 'kJ',
      fat_100g: 30.9,
      'saturated-fat_100g': 10.6,
      carbohydrates_100g: 57.5,
      sugars_100g: 56.3,
      fiber_100g: 0,
      proteins_100g: 6.3,
      salt_100g: 0.107,
      sodium_100g: 0.0428,
      calcium_100g: 0.108,
      iron_100g: 0.0042,
      'vitamin-d_100g': 0.0000015,
      'nutrition-score-fr_100g': 26,
    },
  },
};

describe('Open Food Facts', () => {
  it('maps a product to a Food', () => {
    const f = mapOffProduct(nutella)!;
    expect(f.name).toBe('Nutella hazelnut spread');
    expect(f.brand).toBe('Nutella');
    expect(f.barcode).toBe('3017620422003');
    expect(f.source).toBe('off');
    expect(f.sourceId).toBe('3017620422003');
    expect(f.servings).toEqual([
      { label: '100 g', grams: 100 },
      { label: '15 g', grams: 15 },
    ]);
    expect(f.nutrients[N.energy]).toBe(539);
    expect(f.nutrients[N.fat]).toBe(30.9);
    expect(f.nutrients[N.satFat]).toBe(10.6);
    expect(f.nutrients[N.sodium]).toBeCloseTo(42.8);
    expect(f.nutrients[N.calcium]).toBeCloseTo(108);
    expect(f.nutrients[N.iron]).toBeCloseTo(4.2);
    expect(f.nutrients[N.vitD]).toBeCloseTo(1.5);
    expect(f.nutrients[N.fiber]).toBe(0);
  });

  it('falls back to kJ and salt, parses serving strings', () => {
    const f = mapOffProduct({
      code: '0049000028911',
      product_name: 'Cola',
      serving_size: '1 can (355 ml)',
      nutriments: { 'energy-kj_100g': 176, salt_100g: '0,025', carbohydrates_100g: 10.6 },
    })!;
    expect(f.nutrients[N.energy]).toBe(42);
    expect(f.nutrients[N.sodium]).toBeCloseTo(10);
    expect(f.servings[1]).toEqual({ label: '1 can (355 ml)', grams: 355 });
    expect(f.brand).toBeNull();
    expect(parseServingGrams('2 biscuits (25g)')).toBe(25);
    expect(parseServingGrams('1 slice')).toBeNull();
  });

  it('returns null for missing or empty products', () => {
    expect(mapOffProduct({ status: 0, status_verbose: 'product not found' })).toBeNull();
    expect(mapOffProduct({ status: 1, product: { code: '1', product_name: 'X', nutriments: {} } })).toBeNull();
    expect(mapOffProduct({ status: 1, product: { code: '1', nutriments: { fat_100g: 1 } } })).toBeNull();
    expect(mapOffProduct(null)).toBeNull();
  });

  it('validates barcodes', () => {
    expect(isValidBarcode('3017620422003')).toBe(true); // EAN-13
    expect(isValidBarcode('3017620422004')).toBe(false);
    expect(isValidBarcode('049000028911')).toBe(true); // UPC-A
    expect(isValidBarcode('96385074')).toBe(true); // EAN-8
    expect(upcEToUpcA('04252614')).toBe('042100005264');
    expect(isValidBarcode('04252614')).toBe(true); // UPC-E
    expect(isValidBarcode('abc')).toBe(false);
    expect(isValidBarcode('12345')).toBe(false);
  });

  it('builds the lookup URL and user agent', () => {
    expect(offProductUrl('3017620422003')).toMatch(/^https:\/\/world\.openfoodfacts\.org\/api\/v2\/product\/3017620422003\.json\?fields=/);
    expect(OFF_USER_AGENT).toBe('OpenNutrition/0.1 (https://github.com/ernest-it/open-nutrition)');
  });
});
