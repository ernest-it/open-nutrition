import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { AiError, N, menuItemToFood, type MenuImport } from '@open-nutrition/shared';
import { formatCost, getApiKey, requestMenuImport } from '../aiClient';
import { Icon } from '../icons';
import { useNav } from '../nav';
import { setPrefs, useAccount, usePrefs, useStore } from '../state';
import { Banner, Button, Card, Input, ListRow, Notice, Screen, Segmented, T, haptic, styles, useTheme, useToast } from '../ui';

const g = (v: number | null | undefined) => (v == null ? '–' : `${+v.toFixed(v < 10 ? 1 : 0)}`);

/**
 * Import from a nutrition page: paste a restaurant's nutrition page link (or its text), Claude
 * reads it (through the user's server, or directly with their own key in local mode), and the
 * user picks which items to save as foods.
 */
export function MenuImportScreen({ onDone }: { onDone: () => void }) {
  const t = useTheme();
  const store = useStore();
  const prefs = usePrefs();
  const account = useAccount();
  const toast = useToast();
  const nav = useNav();
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [mode, setMode] = useState<'link' | 'paste'>('link');
  const [url, setUrl] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ menu: MenuImport; costUsd: number | null } | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [filter, setFilter] = useState('');

  useEffect(() => {
    if (!account.server) void getApiKey().then((k) => setHasKey(!!k));
  }, [account]);

  async function read() {
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      const r = await requestMenuImport(account, { ...(mode === 'link' ? { url: url.trim() } : { text }), model: prefs.aiModel, effort: prefs.aiEffort });
      setResult({ menu: r.menu, costUsd: r.costUsd });
      setPicked(new Set());
      if (!r.menu.items.length) setError(r.menu.notes[0] ?? 'No menu items with nutrition information were found on that page.');
      else haptic.success();
    } catch (e) {
      setError(e instanceof AiError ? e.message : (e as Error).message || 'The import failed.');
    } finally {
      setBusy(false);
    }
  }

  function save() {
    if (!result) return;
    const items = result.menu.items.filter((_, i) => picked.has(i));
    for (const it of items) store.upsertFood(menuItemToFood(it, result.menu.restaurant));
    haptic.success();
    toast({ message: `Saved ${items.length} ${items.length === 1 ? 'food' : 'foods'} to My foods`, tone: 'success' });
    onDone();
  }

  // ---- gating -------------------------------------------------------------------------------
  if (!prefs.aiEnabled || (!account.server && hasKey === false)) {
    return (
      <Screen>
        <Card>
          <T bold style={{ fontSize: 18 }}>
            Import from a restaurant’s nutrition page
          </T>
          <T style={{ marginTop: 6 }}>
            Paste the link to a restaurant’s own nutrition page or PDF and Claude lists its items with the published numbers. This uses AI, which is
            {prefs.aiEnabled ? ' not set up on this phone yet: add your Anthropic API key in Settings → AI.' : ' turned off.'}
          </T>
          {!prefs.aiEnabled ? (
            <Button title="Turn on AI" variant="primary" onPress={() => setPrefs({ aiEnabled: true })} />
          ) : (
            <Button title="Open Settings" variant="primary" onPress={() => nav.switchTab('settings')} />
          )}
        </Card>
      </Screen>
    );
  }

  // ---- results ------------------------------------------------------------------------------
  if (result && result.menu.items.length) {
    const words = filter.toLowerCase().split(/\s+/).filter(Boolean);
    const shown = result.menu.items.map((it, i) => ({ it, i })).filter(({ it }) => words.every((w) => it.name.toLowerCase().includes(w)));
    const allShownPicked = shown.length > 0 && shown.every(({ i }) => picked.has(i));
    return (
      <Screen>
        <T muted small>
          {result.menu.items.length} items{result.menu.restaurant ? ` from ${result.menu.restaurant}` : ''} · per serving as published
          {result.costUsd != null ? ` · ${formatCost(result.costUsd)}` : ''}
        </T>
        {result.menu.notes.map((n) => (
          <Notice key={n}>
            <T small>{n}</T>
          </Notice>
        ))}
        <View style={[styles.row, { marginTop: 8 }]}>
          <View style={{ flex: 1 }}>
            <Input value={filter} onChangeText={setFilter} placeholder="Filter items" accessibilityLabel="Filter items" autoCorrect={false} />
          </View>
          <Button
            small
            title={allShownPicked ? 'Clear' : 'Select all'}
            onPress={() =>
              setPicked((p) => {
                const next = new Set(p);
                for (const { i } of shown) allShownPicked ? next.delete(i) : next.add(i);
                return next;
              })
            }
          />
        </View>
        <Card style={{ paddingVertical: 4 }}>
          {shown.map(({ it, i }) => {
            const on = picked.has(i);
            return (
              <ListRow
                key={i}
                title={it.name}
                subtitle={`${it.serving} (${Math.round(it.servingGrams)} g${it.gramsEstimated ? ', est.' : ''}) · ${g(it.nutrients[N.energy])} kcal · P ${g(it.nutrients[N.protein])} · C ${g(it.nutrients[N.carbs])} · F ${g(it.nutrients[N.fat])}`}
                selected={on}
                accessibilityLabel={`${it.name}, ${on ? 'selected' : 'not selected'}`}
                left={
                  <View
                    style={{
                      width: 24,
                      height: 24,
                      borderRadius: 6,
                      borderWidth: 2,
                      borderColor: on ? t.accent : t.muted,
                      backgroundColor: on ? t.accent : 'transparent',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {on && <Icon name="check" size={16} color={t.bg} />}
                  </View>
                }
                onPress={() => {
                  haptic.tap();
                  setPicked((p) => {
                    const next = new Set(p);
                    if (on) next.delete(i);
                    else next.add(i);
                    return next;
                  });
                }}
              />
            );
          })}
        </Card>
        <Button title={picked.size ? `Save ${picked.size} ${picked.size === 1 ? 'food' : 'foods'}` : 'Select items to save'} variant="primary" disabled={!picked.size} onPress={save} />
        <Button title="Read a different page" variant="ghost" onPress={() => setResult(null)} />
      </Screen>
    );
  }

  // ---- input --------------------------------------------------------------------------------
  const canRead = mode === 'link' ? /^https?:\/\/\S+\.\S+/i.test(url.trim()) : text.trim().length >= 50;
  return (
    <Screen>
      <T muted>
        Open the restaurant’s own nutrition page or nutrition PDF in your browser, copy its address and paste it here. Claude lists the items with their
        published numbers; you choose which to save.
      </T>
      <Card style={{ marginTop: 12 }}>
        <Segmented
          options={[
            { value: 'link', label: 'Link' },
            { value: 'paste', label: 'Paste text' },
          ]}
          value={mode}
          onChange={setMode}
        />
        {mode === 'link' ? (
          <Input
            label="Nutrition page or PDF address"
            value={url}
            onChangeText={setUrl}
            placeholder="https://www.example.com/nutrition"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            returnKeyType="go"
            onSubmitEditing={() => canRead && void read()}
          />
        ) : (
          <Input
            label="Nutrition information (copy the table from the page)"
            value={text}
            onChangeText={setText}
            multiline
            style={{ minHeight: 140, textAlignVertical: 'top' }}
            placeholder="Item, Calories, Fat (g), Carbs (g), Protein (g)…"
          />
        )}
        {error && <Banner tone="error" title="Couldn’t import" message={error} onDismiss={() => setError(null)} />}
        <Button title={busy ? 'Reading the page… (up to a minute)' : 'Read menu'} icon="sparkle" variant="primary" onPress={() => void read()} disabled={!canRead} loading={busy} />
        <T small muted>
          Counts as one AI request{account.server ? ' on your server' : ' on your Anthropic key'}. Pages that build their menu with scripts can’t be read
          from a link; paste the text instead.
        </T>
      </Card>
    </Screen>
  );
}
