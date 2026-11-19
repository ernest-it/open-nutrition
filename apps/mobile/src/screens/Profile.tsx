import { useState } from 'react';
import { View } from 'react-native';
import {
  ACTIVITY_FACTORS,
  CORE_NUTRIENTS,
  N,
  NUTRIENTS,
  SETTING_PROFILE,
  computeTargets,
  driDefaults,
  formatNutrient,
  fromCm,
  fromKg,
  fromMl,
  toMl,
  toCm,
  toKg,
  type ActivityLevel,
  type NutrientMap,
  type NutritionStore,
  type Profile,
} from '@open-nutrition/shared';
import { useNav } from '../nav';
import { usePrefs, useStore } from '../state';
import {
  Button,
  Card,
  Chips,
  H2,
  ListRow,
  Notice,
  NumField,
  Screen,
  Segmented,
  T,
  Toggle,
  haptic,
  kcal,
  styles,
  useTheme,
  useToast,
} from '../ui';

const ACTIVITY: { value: ActivityLevel; label: string; hint: string }[] = [
  { value: 'sedentary', label: 'Mostly sitting', hint: 'Desk job, little exercise' },
  { value: 'light', label: 'Lightly active', hint: 'Light exercise 1–3 days a week' },
  { value: 'moderate', label: 'Moderately active', hint: 'Exercise 3–5 days a week' },
  { value: 'active', label: 'Very active', hint: 'Hard exercise 6–7 days a week' },
  { value: 'very_active', label: 'Extremely active', hint: 'Physical job plus training' },
];

const SPLITS: { value: string; label: string; split: Profile['macroSplit'] }[] = [
  { value: 'balanced', label: 'Balanced 25/45/30', split: { protein: 25, carbs: 45, fat: 30 } },
  { value: 'protein', label: 'Higher protein 30/40/30', split: { protein: 30, carbs: 40, fat: 30 } },
  { value: 'lowcarb', label: 'Lower carb 30/25/45', split: { protein: 30, carbs: 25, fat: 45 } },
];

export const DEFAULT_PROFILE: Profile = {
  sex: 'female',
  birthYear: new Date().getFullYear() - 35,
  heightCm: 168,
  activity: 'light',
  goalKgPerWeek: 0,
  proteinGPerKg: 1.6,
  macroSplit: { protein: 25, carbs: 45, fat: 30 },
};

const defaultWater = (p: Pick<Profile, 'sex'>) => (p.sex === 'male' ? 2500 : 2000);

/** Save a profile + weight and set every target from it (effective today). */
export function applyProfile(store: NutritionStore, p: Profile, weightKg: number) {
  store.setSetting(SETTING_PROFILE, p);
  const latest = store.latestWeightKg();
  if (latest == null || Math.abs(latest - weightKg) > 0.05) store.addMeasurement('body_weight', weightKg);
  const water = store.targetsOn(store.today())?.waterMl ?? defaultWater(p);
  store.setTargets(computeTargets(p, weightKg), water);
}

/** Targets for someone who skipped set-up (adult DRIs, 2,000 kcal, balanced split). */
export function applyDefaultTargets(store: NutritionStore) {
  const kcalTarget = 2000;
  store.setTargets(
    {
      ...driDefaults('female', 35, kcalTarget),
      [N.energy]: kcalTarget,
      [N.protein]: Math.round((kcalTarget * 0.25) / 4),
      [N.carbs]: Math.round((kcalTarget * 0.45) / 4),
      [N.fat]: Math.round((kcalTarget * 0.3) / 9),
      [N.fiber]: 28,
    },
    2000,
  );
}

/** Profile form used by onboarding and Settings → Profile. */
export function ProfileForm({ submitLabel, onSaved }: { submitLabel: string; onSaved: () => void }) {
  const t = useTheme();
  const store = useStore();
  const prefs = usePrefs();
  const existing = store.profile();
  const [p, setP] = useState<Profile>(existing ?? DEFAULT_PROFILE);
  const latestKg = store.latestWeightKg();
  const [weight, setWeight] = useState<number | null>(latestKg != null ? +fromKg(latestKg, prefs.weightUnit).toFixed(1) : null);
  const [height, setHeight] = useState<number | null>(+fromCm(p.heightCm, prefs.lengthUnit).toFixed(1));
  const [splitKey, setSplitKey] = useState(() => SPLITS.find((x) => sameSplit(x.split, p.macroSplit))?.value ?? 'custom');
  const set = (patch: Partial<Profile>) => setP((cur) => ({ ...cur, ...patch }));
  const wu = prefs.weightUnit;

  const weightKg = weight != null && weight > 0 ? toKg(weight, wu) : null;
  const heightOk = height != null && height > 0;
  const year = new Date().getFullYear();
  const yearOk = p.birthYear >= year - 110 && p.birthYear <= year - 13;
  const splitSum = p.macroSplit.protein + p.macroSplit.carbs + p.macroSplit.fat;
  const valid = weightKg != null && heightOk && yearOk && Math.abs(splitSum - 100) < 0.5;
  const full: Profile = { ...p, heightCm: heightOk ? toCm(height!, prefs.lengthUnit) : p.heightCm };
  const preview = valid ? computeTargets(full, weightKg!) : null;

  const rates = wu === 'kg' ? [-0.75, -0.5, -0.25, 0, 0.25, 0.5] : [-1.5, -1, -0.5, 0, 0.5, 1];
  const rateValue = String(+fromKg(p.goalKgPerWeek, wu).toFixed(2));

  return (
    <View>
      <Card>
        <T small muted>
          Sex (for the energy equation and nutrient references)
        </T>
        <Segmented
          options={[
            { value: 'female', label: 'Female' },
            { value: 'male', label: 'Male' },
          ]}
          value={p.sex}
          onChange={(v) => set({ sex: v })}
        />
        <NumField label="Birth year" value={p.birthYear} onChange={(v) => set({ birthYear: v ?? 0 })} integer />
        {!yearOk && (
          <T small color={t.warn}>
            Enter a year between {year - 110} and {year - 13}.
          </T>
        )}
        <NumField label="Height" unit={prefs.lengthUnit} value={height} onChange={setHeight} />
        <NumField label="Current weight" unit={wu} value={weight} onChange={setWeight} />
      </Card>
      <H2>Activity</H2>
      <Card style={{ paddingVertical: 4 }}>
        {ACTIVITY.map((a) => (
          <ListRow
            key={a.value}
            title={a.label}
            subtitle={`${a.hint} · ×${ACTIVITY_FACTORS[a.value]}`}
            selected={p.activity === a.value}
            onPress={() => {
              haptic.tap();
              set({ activity: a.value });
            }}
          />
        ))}
      </Card>
      <H2>Goal</H2>
      <Card>
        <T small muted>
          Change per week ({wu})
        </T>
        <Chips
          wrap
          options={rates.map((r) => ({ value: String(r), label: r === 0 ? 'Maintain' : `${r > 0 ? '+' : ''}${r}` }))}
          value={rates.map(String).includes(rateValue) ? rateValue : null}
          onChange={(v) => set({ goalKgPerWeek: toKg(Number(v), wu) })}
        />
        <NumField label="Custom rate" unit={`${wu}/wk`} value={Number(rateValue)} onChange={(v) => set({ goalKgPerWeek: toKg(v ?? 0, wu) })} />
        {Math.abs(p.goalKgPerWeek) > 1 && <Notice tone="warn">More than 1 kg a week is faster than most guidelines recommend.</Notice>}
      </Card>
      <H2>Macros</H2>
      <Card>
        <Toggle
          label="Set protein by body weight"
          hint="Then the split below applies to carbs and fat only"
          value={p.proteinGPerKg != null}
          onChange={(v) => set({ proteinGPerKg: v ? 1.6 : null })}
        />
        {p.proteinGPerKg != null && (
          <NumField label={`Protein per ${wu === 'kg' ? 'kg' : 'kg'} body weight`} unit="g/kg" value={p.proteinGPerKg} onChange={(v) => set({ proteinGPerKg: v ?? 0 })} />
        )}
        <T small muted style={{ marginTop: 6 }}>
          Split of calories (protein / carbs / fat, %)
        </T>
        <Chips
          wrap
          options={[...SPLITS.map((x) => ({ value: x.value, label: x.label })), { value: 'custom', label: 'Custom' }]}
          value={splitKey}
          onChange={(v) => {
            setSplitKey(v);
            const preset = SPLITS.find((x) => x.value === v);
            if (preset) set({ macroSplit: preset.split });
          }}
        />
        {splitKey === 'custom' && (
          <View>
            <NumField label="Protein" unit="%" value={p.macroSplit.protein} onChange={(v) => set({ macroSplit: { ...p.macroSplit, protein: v ?? 0 } })} />
            <NumField label="Carbohydrates" unit="%" value={p.macroSplit.carbs} onChange={(v) => set({ macroSplit: { ...p.macroSplit, carbs: v ?? 0 } })} />
            <NumField label="Fat" unit="%" value={p.macroSplit.fat} onChange={(v) => set({ macroSplit: { ...p.macroSplit, fat: v ?? 0 } })} />
            {Math.abs(splitSum - 100) >= 0.5 && (
              <T small color={t.warn}>
                The split adds up to {splitSum}%; make it 100%.
              </T>
            )}
          </View>
        )}
      </Card>
      {preview && (
        <Card style={{ borderColor: t.accent }}>
          <T small muted>
            Your daily targets
          </T>
          <T bold style={{ fontSize: 24 }}>
            {kcal(preview[N.energy])} kcal
          </T>
          <T muted>
            Protein {Math.round(preview[N.protein] ?? 0)} g · Carbs {Math.round(preview[N.carbs] ?? 0)} g · Fat {Math.round(preview[N.fat] ?? 0)} g
          </T>
          <T small muted style={{ marginTop: 4 }}>
            Mifflin-St Jeor resting energy × activity, adjusted for your goal. Vitamins and minerals use US Dietary Reference Intakes. You can change every
            number later in Settings → Targets.
          </T>
        </Card>
      )}
      <Button
        title={submitLabel}
        variant="primary"
        disabled={!valid}
        onPress={() => {
          applyProfile(store, full, weightKg!);
          haptic.success();
          onSaved();
        }}
      />
    </View>
  );
}

const sameSplit = (a: Profile['macroSplit'], b: Profile['macroSplit']) => a.protein === b.protein && a.carbs === b.carbs && a.fat === b.fat;

export function OnboardingScreen({ onDone }: { onDone: () => void }) {
  const store = useStore();
  return (
    <Screen title="Welcome">
      <T>Let’s set your daily calorie, macro and nutrient targets. It takes a minute, and everything stays editable.</T>
      <ProfileForm submitLabel="Start tracking" onSaved={onDone} />
      <Button
        title="Skip — use standard targets"
        variant="ghost"
        onPress={() => {
          applyDefaultTargets(store);
          onDone();
        }}
      />
    </Screen>
  );
}

export function ProfileScreen({ onDone }: { onDone: () => void }) {
  const toast = useToast();
  return (
    <Screen title="Profile">
      <T muted>Saving recalculates all of today’s targets from your profile. Past days keep the targets they had.</T>
      <ProfileForm
        submitLabel="Save and recalculate targets"
        onSaved={() => {
          toast('Targets updated');
          onDone();
        }}
      />
    </Screen>
  );
}

/** Edit every target by hand. */
export function TargetsScreen({ onDone }: { onDone: () => void }) {
  const store = useStore();
  const prefs = usePrefs();
  const nav = useNav();
  const toast = useToast();
  const current = store.targetsOn(store.today());
  const [values, setValues] = useState<NutrientMap>(() => ({ ...(current?.nutrients ?? {}) }));
  const [water, setWater] = useState<number | null>(current?.waterMl != null ? Math.round(fromMl(current.waterMl, prefs.waterUnit)) : null);
  const [all, setAll] = useState(false);
  const defs = all ? NUTRIENTS : CORE_NUTRIENTS;
  const set = (k: string, v: number | null) =>
    setValues((cur) => {
      const n = { ...cur };
      if (v == null) delete n[k];
      else n[k] = v;
      return n;
    });
  return (
    <Screen title="Targets">
      <T muted>Daily targets from today on. Leave a field empty for no target. Limits (sodium, sugars, saturated fat) are ceilings.</T>
      {store.profile() && <Button small variant="ghost" title="Recalculate from profile…" onPress={() => nav.push({ name: 'profile' })} />}
      <Card>
        {defs.map((d) => (
          <NumField key={d.key} label={`${d.name}${d.limit ? ' (max)' : ''}`} unit={d.unit} value={values[d.key] != null ? +values[d.key]!.toFixed(1) : null} onChange={(v) => set(d.key, v)} />
        ))}
        <NumField label="Water" unit={prefs.waterUnit === 'ml' ? 'ml' : 'fl oz'} value={water} onChange={setWater} />
        <Toggle label="Show all nutrients" value={all} onChange={setAll} />
      </Card>
      <Button
        title="Save targets"
        variant="primary"
        onPress={() => {
          const waterMl = water == null ? null : toMl(water, prefs.waterUnit);
          store.setTargets(values, waterMl);
          haptic.success();
          toast('Targets saved');
          onDone();
        }}
      />
    </Screen>
  );
}

/** Short summary for Settings. */
export function TargetsSummary() {
  const store = useStore();
  const tg = store.targetsOn(store.today());
  if (!tg) return <T muted>No targets set.</T>;
  const n = tg.nutrients;
  return (
    <View style={styles.row}>
      <T style={{ flex: 1 }}>
        {kcal(n[N.energy])} kcal · P {formatNutrient(N.protein, n[N.protein])} · C {formatNutrient(N.carbs, n[N.carbs])} · F {formatNutrient(N.fat, n[N.fat])}
      </T>
    </View>
  );
}
