import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, Linking, ScrollView, StyleSheet, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import {
  AI_MODELS,
  AiError,
  N,
  resolveEstimate,
  rescaleReviewItem,
  reviewItemToLog,
  sumNutrients,
  swapReviewItemFood,
  typicalMealCostUsd,
  type Food,
  type ReviewItem,
} from '@open-nutrition/shared';
import { fetchServerAiStatus, formatCost, getApiKey, prepareImage, requestEstimate, type EstimateResult, type PreparedImage, type ServerAiStatus } from '../aiClient';
import { FoodSearch, MealPicker, macroLine } from '../components';
import { searchFoods } from '../foods';
import { useLayout } from '../layout';
import { useAddNav, useNav } from '../nav';
import { setPrefs, useAccount, usePrefs, useStore } from '../state';
import {
  Badge,
  Banner,
  Button,
  Card,
  Chips,
  Columns,
  IconButton,
  Input,
  MEAL_LABELS,
  Notice,
  SheetHeader,
  Stepper,
  T,
  formatDay,
  haptic,
  kcal,
  styles,
  useConfirm,
  useTheme,
} from '../ui';

type Phase = 'compose' | 'sending' | 'review';

/** "Claude Opus 5.5" instead of a raw model id. */
const modelName = (id: string) => AI_MODELS.find((m) => m.id === id)?.label.split(' — ')[0] ?? id;

export function AiLogScreen({ onBack }: { onBack?: () => void }) {
  const t = useTheme();
  const nav = useAddNav();
  const mainNav = useNav();
  const store = useStore();
  const prefs = usePrefs();
  const account = useAccount();
  const { wide } = useLayout();
  const confirm = useConfirm();

  const [phase, setPhase] = useState<Phase>('compose');
  const [image, setImage] = useState<PreparedImage | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [description, setDescription] = useState('');
  const [error, setError] = useState<{ title: string; message: string; retry?: boolean } | null>(null);
  const [result, setResult] = useState<EstimateResult | null>(null);
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [swapIndex, setSwapIndex] = useState<number | null>(null);
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [serverStatus, setServerStatus] = useState<ServerAiStatus | null | undefined>(undefined);
  const [model, setModel] = useState(prefs.aiModel);

  useEffect(() => {
    if (account.server) void fetchServerAiStatus(account).then(setServerStatus);
    else void getApiKey().then((k) => setHasKey(!!k));
  }, [account]);

  const models = account.server && serverStatus?.models?.length ? AI_MODELS.filter((m) => serverStatus.models.includes(m.id)) : AI_MODELS;
  const modelInfo = models.find((m) => m.id === model) ?? models[0];

  async function pick(source: 'camera' | 'library') {
    setError(null);
    try {
      if (source === 'camera') {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) {
          setError({ title: 'Camera access is off', message: 'Allow it in system settings, or choose a photo from your library.' });
          return;
        }
      }
      const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 1, exif: false, allowsEditing: false };
      const res = source === 'camera' ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
      if (res.canceled || !res.assets?.[0]) return;
      const a = res.assets[0];
      setPreparing(true);
      setImage(await prepareImage(a.uri, a.width, a.height));
    } catch (e) {
      setError({ title: 'Could not use that photo', message: (e as Error).message });
    } finally {
      setPreparing(false);
    }
  }

  // Each request gets a number; cancelling (or leaving) bumps it so a late answer is ignored.
  const request = useRef(0);
  useEffect(
    () => () => {
      request.current++;
    },
    [],
  );

  async function send() {
    setError(null);
    setPhase('sending');
    const my = ++request.current;
    try {
      const r = await requestEstimate(account, {
        model: modelInfo?.id ?? prefs.aiModel,
        effort: prefs.aiEffort,
        imageBase64: image?.base64 ?? null,
        description: description.trim() || null,
      });
      const resolved = await resolveEstimate(r.estimate, (q) => searchFoods(store, q, 12));
      if (my !== request.current) return;
      setResult(r);
      setItems(resolved);
      setPhase('review');
      haptic.success();
    } catch (e) {
      if (my !== request.current) return;
      setError({ title: 'The estimate didn’t work', message: e instanceof AiError ? e.message : (e as Error).message, retry: true });
      setPhase('compose');
      haptic.warn();
    }
  }

  function cancelSend() {
    request.current++;
    setPhase('compose');
  }

  const added = useRef(false);
  function addAll() {
    if (!result || added.current) return;
    added.current = true;
    const kept = items.filter((i) => i.grams > 0);
    const row = store.recordAiEstimate({
      date: nav.day,
      meal: nav.meal,
      photoHash: image?.sha256 ?? null,
      description: description.trim() || null,
      model: result.model,
      response: result.estimate,
      accepted: kept.map((i) => ({ name: i.name, grams: i.grams, foodName: i.matchedFood?.name ?? null, usedAi: i.usedAi, nutrients: i.nutrients })),
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
    });
    const logged = kept.map((it) => store.logFood({ day: nav.day, meal: nav.meal, ...reviewItemToLog(it), aiEstimateId: row.id }));
    nav.close(`Added ${kept.length} item${kept.length === 1 ? '' : 's'} to ${MEAL_LABELS[nav.meal].toLowerCase()}`, () =>
      logged.forEach((e) => store.remove('diaryEntries', e.id)),
    );
  }

  /** Ask before throwing away a reviewed estimate (it cost money and time). Resolves true if discarded. */
  async function discard(): Promise<boolean> {
    const ok = await confirm({
      title: 'Discard this estimate?',
      message: 'Nothing will be added to your diary.',
      confirmLabel: 'Discard',
      cancelLabel: 'Keep reviewing',
      destructive: true,
    });
    if (!ok) return false;
    if (result) {
      store.recordAiEstimate({
        date: nav.day,
        meal: nav.meal,
        photoHash: image?.sha256 ?? null,
        description: description.trim() || null,
        model: result.model,
        response: result.estimate,
        accepted: null,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
      });
    }
    setPhase('compose');
    setResult(null);
    setItems([]);
    return true;
  }

  // In review, hardware back asks before discarding instead of silently dropping the estimate.
  const reviewing = phase === 'review';
  const backRef = useRef<() => void>(() => {});
  backRef.current = () => (swapIndex != null ? setSwapIndex(null) : void discard());
  useEffect(() => {
    if (!reviewing) return;
    nav.setBackGuard(() => backRef.current());
    return () => nav.setBackGuard(null);
  }, [reviewing, nav]);

  const header = (
    <SheetHeader
      title={`Photo / describe · ${MEAL_LABELS[nav.meal]}`}
      onBack={reviewing ? () => void discard() : onBack}
      onClose={reviewing ? () => void discard().then((ok) => ok && nav.close()) : () => nav.close()}
    />
  );

  // ---- swap an item for a database food ----
  if (swapIndex != null && items[swapIndex]) {
    const item = items[swapIndex]!;
    return (
      <View style={{ flex: 1 }}>
        <SheetHeader title={`Replace “${item.name}”`} onBack={() => setSwapIndex(null)} />
        <FoodSearch
          autoFocus
          initialQuery={item.usdaQuery || item.name}
          onPick={(f: Food) => {
            setItems((list) => list.map((x, i) => (i === swapIndex ? swapReviewItemFood(x, f) : x)));
            setSwapIndex(null);
            haptic.tap();
          }}
        />
      </View>
    );
  }

  // ---- gating: AI off, no key, server without AI ----
  if (!prefs.aiEnabled) {
    return (
      <View style={{ flex: 1 }}>
        {header}
        <ScrollView contentContainerStyle={{ padding: 16 }}>
          <Card>
            <T bold style={{ fontSize: 18 }}>
              Log a meal from a photo or a description
            </T>
            <T style={{ marginTop: 6 }}>
              Claude, an AI model made by Anthropic, estimates the foods and portions. You always review and correct the estimate before anything is saved.
            </T>
            <Notice tone="warn">
              <T small>
                Privacy: when you use this, your photo and description are sent to Anthropic
                {account.server ? ' through your server' : ' directly from this phone'}. AI logging stays off until you turn it on, and you can turn it off
                again in Settings.
              </T>
            </Notice>
            <Button title="Turn on AI logging" variant="primary" onPress={() => setPrefs({ aiEnabled: true })} />
            <Button title="Not now" variant="ghost" onPress={onBack ?? (() => nav.close())} />
          </Card>
        </ScrollView>
      </View>
    );
  }
  if (!account.server && hasKey === false) {
    return (
      <View style={{ flex: 1 }}>
        {header}
        <ScrollView contentContainerStyle={{ padding: 16 }}>
          <Card>
            <T bold>Add your Anthropic API key</T>
            <T style={{ marginTop: 6 }}>
              In local-only mode the app calls Claude directly with your own key. It is stored only on this device (in the system keychain) and sent only to
              Anthropic.
            </T>
            <Button
              title="Open AI settings"
              variant="primary"
              onPress={() => {
                nav.close();
                mainNav.switchTab('settings');
              }}
            />
            <Button title="How to create a key" variant="ghost" onPress={() => void Linking.openURL('https://console.anthropic.com/settings/keys')} />
          </Card>
        </ScrollView>
      </View>
    );
  }
  if (account.server && serverStatus && !serverStatus.enabled) {
    return (
      <View style={{ flex: 1 }}>
        {header}
        <View style={{ padding: 16 }}>
          <Notice>AI logging is not set up on your server. Ask the server’s owner to set an Anthropic API key (LLM_API_KEY).</Notice>
        </View>
      </View>
    );
  }

  // ---- sending ----
  if (phase === 'sending') {
    return (
      <View style={{ flex: 1 }}>
        {header}
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 }}>
          <ActivityIndicator size="large" color={t.accent} />
          <T bold>Estimating your meal…</T>
          <T small muted style={{ textAlign: 'center', maxWidth: 360 }}>
            This usually takes 5–20 seconds. Portions are then matched against the USDA database.
          </T>
          <Button title="Cancel" variant="ghost" onPress={cancelSend} />
        </View>
      </View>
    );
  }

  // ---- review ----
  if (phase === 'review' && result) {
    const totals = sumNutrients(items.map((i) => i.nutrients));
    const itemsView = (
      <View>
        {items.length === 0 && (
          <Card>
            <T>No food was recognised. {result.estimate.assumptions[0] ?? ''}</T>
          </Card>
        )}
        {items.map((it, i) => (
          <ReviewCard
            key={`${i}-${it.name}`}
            item={it}
            onGrams={(g) => setItems((list) => list.map((x, j) => (j === i ? rescaleReviewItem(x, g) : x)))}
            onSwap={() => setSwapIndex(i)}
            onDelete={() => {
              haptic.light();
              setItems((list) => list.filter((_, j) => j !== i));
            }}
          />
        ))}
      </View>
    );
    const summary = (
      <View>
        <Card>
          <T small muted>
            Total
          </T>
          <T bold style={{ fontSize: 24 }}>
            {kcal(totals[N.energy])} kcal
          </T>
          <T muted>{macroLine(totals)}</T>
          {result.costUsd != null && (
            <T small muted style={{ marginTop: 4 }}>
              This estimate cost {formatCost(result.costUsd)} ({modelName(result.model)}).
            </T>
          )}
        </Card>
        {result.estimate.assumptions.length > 0 && (
          <Card>
            <T bold>Assumptions to check</T>
            {result.estimate.assumptions.map((a, i) => (
              <T key={i} small style={{ marginTop: 4 }}>
                • {a}
              </T>
            ))}
          </Card>
        )}
        <Card>
          <T small muted>
            Add to
          </T>
          <MealPicker value={nav.meal} onChange={nav.setMeal} />
          <T small muted>
            {formatDay(nav.day, true)}
          </T>
          <Button title={`Add ${items.length} item${items.length === 1 ? '' : 's'} to diary`} variant="primary" icon="check" disabled={!items.length} onPress={addAll} />
          <Button title="Discard" variant="danger" onPress={discard} />
        </Card>
      </View>
    );
    return (
      <View style={{ flex: 1 }}>
        {header}
        <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: 32 }} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
          <Notice>Review every item. Adjust the grams, swap anything that was misidentified, and delete what you didn’t eat. Nothing is saved until you tap Add.</Notice>
          {wide ? (
            <Columns left={itemsView} right={summary} ratio={1.4} gap={12} />

          ) : (
            <>
              {itemsView}
              {summary}
            </>
          )}
        </ScrollView>
      </View>
    );
  }

  // ---- compose ----
  const cost = modelInfo ? typicalMealCostUsd(modelInfo.id) : null;
  return (
    <View style={{ flex: 1 }}>
      {header}
      <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: 32 }} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
        <Card>
          {image ? (
            <View>
              <Image source={{ uri: image.uri }} style={[s.preview, { aspectRatio: image.width / Math.max(1, image.height) }]} resizeMode="cover" accessibilityLabel="Meal photo" />
              <Button small variant="danger" title="Remove photo" onPress={() => setImage(null)} style={{ alignSelf: 'flex-start', marginTop: 6 }} />
            </View>
          ) : (
            <View style={[styles.row, { flexWrap: 'wrap' }]}>
              <Button title="Take a photo" icon="camera" variant="primary" onPress={() => void pick('camera')} disabled={preparing} style={{ flexGrow: 1 }} />
              <Button title="Choose photo" icon="image" onPress={() => void pick('library')} disabled={preparing} style={{ flexGrow: 1 }} />
            </View>
          )}
          {preparing && <ActivityIndicator style={{ marginTop: 8 }} />}
          <T small muted style={{ marginTop: 10 }}>
            Describe it (optional with a photo). Details you give win over the photo, e.g. “half the rice, no sour cream”.
          </T>
          <Input
            value={description}
            onChangeText={setDescription}
            placeholder="e.g. Chicken burrito bowl with black beans and salsa"
            multiline
            maxLength={2000}
            style={{ minHeight: 80, textAlignVertical: 'top' }}
            accessibilityLabel="Meal description"
          />
        </Card>
        <Card>
          <T small muted>
            Model
          </T>
          <Chips options={models.map((m) => ({ value: m.id, label: m.label.split(' — ')[0]!.replace('Claude ', '') }))} value={modelInfo?.id ?? null} onChange={setModel} />
          {cost != null && (
            <T small muted>
              Estimated cost: {formatCost(cost)} per photo on {modelInfo?.label.split(' — ')[0]}
              {account.server ? ' (paid by your server)' : ' (billed to your Anthropic account)'}.
            </T>
          )}
          {account.server && serverStatus && serverStatus.monthlyLimit > 0 && (
            <T small muted>
              {serverStatus.usedThisMonth} of {serverStatus.monthlyLimit} AI logs used this month.
            </T>
          )}
          <T small muted style={{ marginTop: 4 }}>
            Your photo and description are sent to Anthropic to make the estimate.
          </T>
        </Card>
        {error && (
          <Banner
            tone="error"
            title={error.title}
            message={error.message}
            onDismiss={() => setError(null)}
            action={error.retry && (image || description.trim()) ? { label: 'Try again', onPress: () => void send() } : undefined}
          />
        )}
        <Button title="Estimate" variant="primary" icon="sparkle" disabled={(!image && !description.trim()) || preparing} onPress={() => void send()} />
        {!image && !description.trim() && (
          <T small muted style={{ textAlign: 'center' }}>
            Add a photo or a description to get an estimate.
          </T>
        )}
      </ScrollView>
    </View>
  );
}

function ReviewCard({ item, onGrams, onSwap, onDelete }: { item: ReviewItem; onGrams: (g: number) => void; onSwap: () => void; onDelete: () => void }) {
  const t = useTheme();
  const conf = { high: t.success, medium: t.warn, low: t.danger }[item.confidence];
  const step = item.grams >= 200 ? 25 : item.grams >= 50 ? 10 : 5;
  return (
    <Card>
      <View style={[styles.row, { alignItems: 'flex-start' }]}>
        <View style={{ flex: 1 }}>
          <T bold style={{ fontSize: 16 }}>
            {item.name}
          </T>
          <View style={[styles.row, { flexWrap: 'wrap', marginTop: 2, gap: 6 }]}>
            <Badge text={`${item.confidence} confidence`} color={conf} />
            {item.usedAi ? <Badge text="AI estimate" color={t.accent} /> : <Badge text="USDA match" color={t.success} />}
          </View>
          {item.matchedFood && (
            <T small muted style={{ marginTop: 2 }} lines={2}>
              {item.matchedFood.name}
            </T>
          )}
          {item.notes && (
            <T small muted style={{ marginTop: 2, fontStyle: 'italic' }}>
              {item.notes}
            </T>
          )}
        </View>
        <IconButton icon="trash" label={`Remove ${item.name}`} color={t.danger} onPress={onDelete} />
      </View>
      <View style={[styles.rowBetween, { flexWrap: 'wrap', marginTop: 6 }]}>
        <Stepper label={`${item.name} grams`} value={Math.round(item.grams)} step={step} onChange={onGrams} unit="g" />
        <View style={{ alignItems: 'flex-end' }}>
          <T bold>{kcal(item.nutrients[N.energy])} kcal</T>
          <T small muted>
            {macroLine(item.nutrients)}
          </T>
        </View>
      </View>
      <View style={[styles.row, { flexWrap: 'wrap', marginTop: 4 }]}>
        {[0.5, 0.75, 1.25, 1.5].map((f) => (
          <Button key={f} small title={`×${f}`} onPress={() => onGrams(Math.round(item.grams * f))} accessibilityLabel={`Multiply portion by ${f}`} />
        ))}
        <Button small variant="ghost" icon="search" title={item.matchedFood ? 'Swap food' : 'Find in database'} onPress={onSwap} />
      </View>
    </Card>
  );
}

const s = StyleSheet.create({
  preview: { width: '100%', maxHeight: 360, borderRadius: 12 },
});
