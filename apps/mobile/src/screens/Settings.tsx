import { useEffect, useState, type ReactNode } from 'react';
import { Linking, View } from 'react-native';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import Constants from 'expo-constants';
import { AI_MODELS, OFF_ATTRIBUTION, USDA_ATTRIBUTION, diaryToCsv, maskApiKey, typicalMealCostUsd } from '@open-nutrition/shared';
import { fetchServerAiStatus, formatCost, getApiKey, looksLikeAnthropicKey, removeApiKey, setApiKey, type ServerAiStatus } from '../aiClient';
import { foodDbError } from '../foods';
import { Icon, type IconName } from '../icons';
import { useLayout } from '../layout';
import { useNav } from '../nav';
import { LocalDataCard } from '../localData';
import { setPrefs, useAccount, usePrefs, useStore } from '../state';
import { Banner, Button, Card, Chips, Columns, Input, ListRow, Notice, Screen, Segmented, T, Toggle, haptic, styles, useConfirm, useTheme, useToast } from '../ui';
import { TargetsSummary } from './Profile';

const timeOf = (ms: number) => new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

export function SettingsScreen({ onSignOut }: { onSignOut: () => Promise<void> }) {
  const store = useStore();
  const prefs = usePrefs();
  const account = useAccount();
  const nav = useNav();
  const toast = useToast();
  const confirm = useConfirm();
  const { wide } = useLayout();
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [leaving, setLeaving] = useState(false);

  async function exportCsv() {
    setExportError(null);
    const entries = store.all('diaryEntries');
    if (!entries.length) {
      toast('Nothing to export yet: your diary is empty.');
      return;
    }
    setExporting(true);
    try {
      if (!(await Sharing.isAvailableAsync())) {
        setExportError('Sharing files is not available on this device.');
        return;
      }
      const file = new File(Paths.cache, `open-nutrition-diary-${store.today()}.csv`);
      await file.write(diaryToCsv(entries));
      // The OS share sheet stays native (save to Files, send to another app…).
      await Sharing.shareAsync(file.uri, { mimeType: 'text/csv', UTI: 'public.comma-separated-values-text', dialogTitle: 'Export diary' });
    } catch (e) {
      setExportError((e as Error).message || 'The file could not be written.');
    } finally {
      setExporting(false);
    }
  }

  async function syncNow() {
    setSyncing(true);
    try {
      await store.sync();
    } catch {
      /* the error is shown from store.lastSyncError */
    } finally {
      setSyncing(false);
    }
    if (!store.lastSyncError) toast({ message: 'Everything is synced', tone: 'success' });
  }

  async function leave() {
    const pending = store.pendingCount();
    const ok = await confirm(
      account.server
        ? {
            title: 'Sign out?',
            message: pending
              ? `${pending} change${pending === 1 ? ' has' : 's have'} not synced yet and will be lost on this phone.`
              : 'Your data stays on your server. Sign in again any time.',
            confirmLabel: 'Sign out',
            destructive: pending > 0,
          }
        : {
            title: 'Leave local mode?',
            message: 'Your local data stays on this phone. After you sign in to a server you can move it into your account.',
            confirmLabel: 'Continue',
          },
    );
    if (!ok) return;
    setLeaving(true);
    try {
      await onSignOut();
    } catch {
      setLeaving(false);
    }
  }

  const cards: ReactNode[] = [
    <Card key="targets">
      <SectionTitle icon="nutrients">Profile & targets</SectionTitle>
      <TargetsSummary />
      <View style={[styles.row, { flexWrap: 'wrap', marginTop: 6 }]}>
        <Button small icon="edit" title="Edit targets" onPress={() => nav.push({ name: 'targets' })} />
        <Button small icon="user" title={store.profile() ? 'Edit profile' : 'Set up profile'} onPress={() => nav.push({ name: 'profile' })} />
      </View>
    </Card>,
    <Card key="units">
      <SectionTitle icon="scale">Units</SectionTitle>
      <Row label="Body weight">
        <Segmented options={[{ value: 'kg', label: 'kg' }, { value: 'lb', label: 'lb' }]} value={prefs.weightUnit} onChange={(v) => setPrefs({ weightUnit: v })} />
      </Row>
      <Row label="Length">
        <Segmented options={[{ value: 'cm', label: 'cm' }, { value: 'in', label: 'in' }]} value={prefs.lengthUnit} onChange={(v) => setPrefs({ lengthUnit: v })} />
      </Row>
      <Row label="Water">
        <Segmented options={[{ value: 'ml', label: 'ml' }, { value: 'floz', label: 'fl oz' }]} value={prefs.waterUnit} onChange={(v) => setPrefs({ waterUnit: v })} />
      </Row>
      <T small muted>
        Foods are always weighed in grams.
      </T>
    </Card>,
    <AiSettings key="ai" />,
    <Card key="sync">
      <SectionTitle icon="cloud">Server & sync</SectionTitle>
      {account.server ? (
        <>
          <T small muted>
            Signed in as {account.server.username} on {account.server.baseUrl.replace(/^https?:\/\//, '')}
          </T>
          <T small muted>
            {store.pendingCount() ? `${store.pendingCount()} change${store.pendingCount() === 1 ? '' : 's'} waiting to sync` : 'All changes synced'}
            {` · last sync ${store.lastSyncAt ? timeOf(store.lastSyncAt) : 'never'}`}
          </T>
          {store.lastSyncError && <Banner tone="error" title="Last sync failed" message={store.lastSyncError} />}
          <Button title="Sync now" icon="cloud" onPress={() => void syncNow()} loading={syncing} />
        </>
      ) : (
        <T small muted>
          Local-only mode: your data stays on this phone. Connect a server to sync and back up.
        </T>
      )}
      <Button
        title={account.server ? 'Sign out' : 'Connect a server'}
        variant={account.server ? 'danger' : 'default'}
        onPress={() => void leave()}
        loading={leaving}
      />
    </Card>,
    <LocalDataCard key="local" />,
    <Card key="data">
      <SectionTitle icon="download">Your data</SectionTitle>
      <T small muted>
        Export every diary entry (date, meal, food, amount and core nutrients) as a CSV file.
      </T>
      {exportError && <Banner tone="error" title="Export failed" message={exportError} onDismiss={() => setExportError(null)} action={{ label: 'Try again', onPress: () => void exportCsv() }} />}
      <Button title="Export diary (CSV)" icon="download" onPress={() => void exportCsv()} loading={exporting} />
    </Card>,
    <About key="about" />,
  ];

  if (!wide) return <Screen title="Settings">{cards}</Screen>;
  const left = cards.filter((_, i) => i % 2 === 0);
  const right = cards.filter((_, i) => i % 2 === 1);
  return (
    <Screen title="Settings" wide>
      <Columns left={left} right={right} />

    </Screen>
  );
}

function SectionTitle({ icon, children }: { icon: IconName; children: string }) {
  const t = useTheme();
  return (
    <View style={[styles.row, { marginBottom: 6 }]}>
      <Icon name={icon} size={18} color={t.accent} />
      <T bold style={{ fontSize: 16 }} accessibilityRole="header">
        {children}
      </T>
    </View>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={[styles.row, { flexWrap: 'wrap' }]}>
      <T style={{ width: 110 }}>{label}</T>
      <View style={{ flex: 1, minWidth: 150 }}>{children}</View>
    </View>
  );
}

function AiSettings() {
  const t = useTheme();
  const prefs = usePrefs();
  const account = useAccount();
  const toast = useToast();
  const confirm = useConfirm();
  const [masked, setMasked] = useState<string | null | undefined>(undefined);
  const [draft, setDraft] = useState('');
  const [status, setStatus] = useState<ServerAiStatus | null | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [keyError, setKeyError] = useState<string | null>(null);

  useEffect(() => {
    if (account.server) void fetchServerAiStatus(account).then(setStatus);
    // Only the masked form is kept in memory for display.
    else void getApiKey().then((k) => setMasked(k ? maskApiKey(k) : null));
  }, [account]);

  // In server mode AI runs through the server: when it isn't configured there, the switch can't be on.
  const unavailable =
    account.server && status === undefined
      ? 'Checking whether your server provides AI…'
      : account.server && status && !status.enabled
        ? 'Not available: AI is not configured on your server (it needs LLM_API_KEY).'
        : null;
  const aiOn = prefs.aiEnabled && unavailable == null;
  const models = account.server && status?.models?.length ? AI_MODELS.filter((m) => status.models.includes(m.id)) : AI_MODELS;

  async function saveKey() {
    const k = draft.trim();
    setKeyError(null);
    setSaving(true);
    try {
      await setApiKey(k);
      setMasked(maskApiKey(k));
      setDraft('');
      haptic.success();
      toast({ message: 'Key saved on this device', tone: 'success' });
    } catch (e) {
      setKeyError((e as Error).message || 'The system keychain refused the key.');
    } finally {
      setSaving(false);
    }
  }

  async function removeKey() {
    const ok = await confirm({
      title: 'Remove the API key?',
      message: 'AI logging stops working on this phone until you add a key again. The key itself stays valid in the Claude Console.',
      confirmLabel: 'Remove key',
      destructive: true,
    });
    if (!ok) return;
    await removeApiKey();
    setMasked(null);
    toast('Key removed from this phone');
  }

  return (
    <Card>
      <SectionTitle icon="sparkle">AI meal logging</SectionTitle>
      <Toggle
        label="Log meals from photos and descriptions"
        hint={unavailable ?? 'Off by default. Uses Claude by Anthropic.'}
        value={aiOn}
        disabled={unavailable != null}
        onChange={(v) => setPrefs({ aiEnabled: v })}
      />
      <Notice tone="warn">
        {`Privacy: when you use AI logging, the meal photo and description are sent to Anthropic${account.server ? ' via your server' : ''}. Nothing is sent while this is off.`}
      </Notice>
      {aiOn && (
        <View>
          <T small muted bold style={{ marginTop: 8 }}>
            Model
          </T>
          {models.map((m) => (
            <ListRow
              key={m.id}
              title={m.label}
              subtitle={`About ${formatCost(typicalMealCostUsd(m.id))} per photo${m.id === 'claude-haiku-5-5' ? ' · cheapest' : m.id === 'claude-opus-5-5' ? ' · default' : ''}`}
              selected={prefs.aiModel === m.id}
              right={prefs.aiModel === m.id ? <Icon name="check" size={18} color={t.accent} /> : undefined}
              onPress={() => {
                haptic.tap();
                setPrefs({ aiModel: m.id });
              }}
            />
          ))}
          <T small muted bold style={{ marginTop: 8 }}>
            Effort (higher can be slower and costlier)
          </T>
          <Chips
            options={[
              { value: 'low', label: 'Low (fast)' },
              { value: 'medium', label: 'Medium' },
              { value: 'high', label: 'High' },
            ]}
            value={prefs.aiEffort}
            onChange={(v) => setPrefs({ aiEffort: v })}
          />
          {account.server && status && status.enabled && status.webSearch === false ? (
            <T small muted style={{ marginTop: 8 }}>
              Web lookups for brand-name items are turned off on your server.
            </T>
          ) : (
            <Toggle
              label="Always search the web"
              hint="Brand-name and restaurant items are always looked up and show their source. Turn this on to search for every meal, even plain foods: slower, and each search costs about 1¢ plus the text it returns."
              value={prefs.aiWebSearch === 'always'}
              onChange={(v) => setPrefs({ aiWebSearch: v ? 'always' : 'auto' })}
            />
          )}
          {account.server ? (
            status === undefined ? (
              <T small muted style={{ marginTop: 6 }}>
                Checking your server…
              </T>
            ) : status == null ? (
              <Banner tone="warn" message="Could not reach your server’s AI service. Check your connection and try again later." />
            ) : status.enabled ? (
              <T small muted style={{ marginTop: 6 }}>
                {`Your server provides AI${status.monthlyLimit ? ` (${status.usedThisMonth} of ${status.monthlyLimit} logs used this month)` : ''}. No key is needed on this phone.`}
              </T>
            ) : (
              <Banner tone="warn" message="AI is not configured on your server (it needs LLM_API_KEY)." />
            )
          ) : (
            <View style={{ marginTop: 8 }}>
              <T bold>Your Anthropic API key</T>
              <Notice>
                Your key is stored only on this device (in the system keychain) and sent only to Anthropic. Create a dedicated key in a workspace with a monthly spend
                limit in the Claude Console, so a lost phone can cost little and the key can be revoked on its own.
              </Notice>
              {masked === undefined ? null : masked ? (
                <View style={[styles.rowBetween, { flexWrap: 'wrap' }]}>
                  <T style={{ fontFamily: 'monospace' }}>{masked}</T>
                  <Button small icon="trash" variant="danger" title="Remove key" onPress={() => void removeKey()} />
                </View>
              ) : (
                <View>
                  <Input
                    value={draft}
                    onChangeText={(v) => {
                      setDraft(v);
                      setKeyError(null);
                    }}
                    placeholder="sk-ant-…"
                    secureTextEntry
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoComplete="off"
                    importantForAutofill="no"
                    textContentType="none"
                    accessibilityLabel="Anthropic API key"
                    returnKeyType="done"
                    onSubmitEditing={() => looksLikeAnthropicKey(draft) && void saveKey()}
                  />
                  {!!draft && !looksLikeAnthropicKey(draft) && (
                    <T small color={t.warn}>
                      Anthropic keys start with “sk-ant-”.
                    </T>
                  )}
                  {keyError && <Banner tone="error" title="Could not save the key" message={keyError} />}
                  <View style={[styles.row, { flexWrap: 'wrap' }]}>
                    <Button title="Save key" variant="primary" disabled={!looksLikeAnthropicKey(draft)} loading={saving} onPress={() => void saveKey()} />
                    <Button variant="ghost" title="Get a key" onPress={() => void Linking.openURL('https://console.anthropic.com/settings/keys')} />
                  </View>
                </View>
              )}
            </View>
          )}
        </View>
      )}
    </Card>
  );
}

function About() {
  const account = useAccount();
  const version = Constants.expoConfig?.version ?? '';
  const dbErr = foodDbError();
  return (
    <Card>
      <SectionTitle icon="info">About</SectionTitle>
      <T small muted>
        Open Nutrition {version} is source-available under the PolyForm Noncommercial License 1.0.0: free for non-commercial use, changes and sharing;
        commercial use needs a separate license. Built with open-source libraries.
      </T>
      <T small style={{ marginTop: 8 }}>
        Food data from USDA FoodData Central and Open Food Facts (ODbL).
      </T>
      <T small muted style={{ marginTop: 4 }}>
        {USDA_ATTRIBUTION}
      </T>
      <T small muted style={{ marginTop: 4 }}>
        {OFF_ATTRIBUTION}
      </T>
      {dbErr && <Banner tone="error" title="The bundled food database could not be opened" message={dbErr} />}
      <View style={[styles.row, { flexWrap: 'wrap', marginTop: 4 }]}>
        <Button small variant="ghost" title="License" onPress={() => void Linking.openURL('https://polyformproject.org/licenses/noncommercial/1.0.0')} />
        <Button small variant="ghost" title="USDA FoodData Central" onPress={() => void Linking.openURL('https://fdc.nal.usda.gov')} />
        <Button small variant="ghost" title="Open Food Facts" onPress={() => void Linking.openURL('https://world.openfoodfacts.org')} />
        {account.server && (
          <Button small variant="ghost" title="Third-party notices" onPress={() => void Linking.openURL(`${account.server!.baseUrl}/third-party-notices.txt`)} />
        )}
      </View>
    </Card>
  );
}

/** "More" tab: weight & body, foods, settings. */
export function MoreScreen() {
  const nav = useNav();
  const t = useTheme();
  const items: { title: string; subtitle: string; tab: 'body' | 'foods' | 'settings'; icon: IconName }[] = [
    { title: 'Weight & body', subtitle: 'Weigh-ins, trend, measurements', tab: 'body', icon: 'scale' },
    { title: 'Foods & recipes', subtitle: 'Custom foods, favourites, recipes, saved meals', tab: 'foods', icon: 'food' },
    { title: 'Settings', subtitle: 'Targets, units, AI, server, export, about', tab: 'settings', icon: 'settings' },
  ];
  return (
    <Screen title="More">
      <Card style={{ paddingVertical: 4, paddingHorizontal: 4 }}>
        {items.map((i) => (
          <ListRow
            key={i.tab}
            title={i.title}
            subtitle={i.subtitle}
            onPress={() => nav.push({ name: i.tab })}
            left={
              <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: t.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name={i.icon} size={20} color={t.accent} />
              </View>
            }
            right={<Icon name="chevronRight" size={18} color={t.muted} />}
          />
        ))}
      </Card>
    </Screen>
  );
}
