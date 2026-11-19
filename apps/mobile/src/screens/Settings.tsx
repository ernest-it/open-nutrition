import { useEffect, useState, type ReactNode } from 'react';
import { Alert, Linking, View } from 'react-native';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import Constants from 'expo-constants';
import { AI_MODELS, OFF_ATTRIBUTION, USDA_ATTRIBUTION, diaryToCsv, maskApiKey, typicalMealCostUsd } from '@open-nutrition/shared';
import { fetchServerAiStatus, formatCost, getApiKey, looksLikeAnthropicKey, removeApiKey, setApiKey, type ServerAiStatus } from '../aiClient';
import { foodDbError } from '../foods';
import { useLayout } from '../layout';
import { useNav } from '../nav';
import { setPrefs, useAccount, usePrefs, useStore } from '../state';
import { Button, Card, Chips, Input, ListRow, Notice, Screen, Segmented, T, Toggle, haptic, styles, useTheme, useToast } from '../ui';
import { TargetsSummary } from './Profile';

export function SettingsScreen({ onSignOut }: { onSignOut: () => void }) {
  const store = useStore();
  const prefs = usePrefs();
  const account = useAccount();
  const nav = useNav();
  const { wide } = useLayout();

  async function exportCsv() {
    try {
      const entries = store.all('diaryEntries');
      if (!entries.length) {
        Alert.alert('Nothing to export', 'Your diary is empty.');
        return;
      }
      const file = new File(Paths.cache, `open-nutrition-diary-${store.today()}.csv`);
      await file.write(diaryToCsv(entries));
      if (!(await Sharing.isAvailableAsync())) {
        Alert.alert('Sharing is not available on this device');
        return;
      }
      await Sharing.shareAsync(file.uri, { mimeType: 'text/csv', UTI: 'public.comma-separated-values-text', dialogTitle: 'Export diary' });
    } catch (e) {
      Alert.alert('Export failed', (e as Error).message);
    }
  }

  const cards: ReactNode[] = [
    <Card key="targets">
      <T bold>Profile & targets</T>
      <TargetsSummary />
      <View style={[styles.row, { flexWrap: 'wrap', marginTop: 6 }]}>
        <Button small title="Edit targets" onPress={() => nav.push({ name: 'targets' })} />
        <Button small title={store.profile() ? 'Edit profile' : 'Set up profile'} onPress={() => nav.push({ name: 'profile' })} />
      </View>
    </Card>,
    <Card key="units">
      <T bold>Units</T>
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
      <T bold>Server & sync</T>
      {account.server ? (
        <>
          <T small muted>
            {account.server.username} @ {account.server.baseUrl}
          </T>
          <T small muted>
            {store.pendingCount()} pending · last sync {store.lastSyncAt ? new Date(store.lastSyncAt).toLocaleTimeString() : 'never'}
          </T>
          {store.lastSyncError && (
            <T small color="#dc2626">
              {store.lastSyncError}
            </T>
          )}
          <Button title="Sync now" onPress={() => void store.sync().catch(() => {})} />
        </>
      ) : (
        <T small muted>
          Local-only mode: your data stays on this phone. Connect a server to sync and back up.
        </T>
      )}
      <Button
        title={account.server ? 'Sign out' : 'Connect a server'}
        variant="danger"
        onPress={() =>
          Alert.alert(
            account.server ? 'Sign out?' : 'Leave local mode?',
            account.server
              ? store.pendingCount()
                ? 'Some changes have not synced yet and will be lost.'
                : 'Your data stays on the server.'
              : 'Local data stays on this device and comes back if you choose local mode again.',
            [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Continue', style: 'destructive', onPress: onSignOut },
            ],
          )
        }
      />
    </Card>,
    <Card key="data">
      <T bold>Your data</T>
      <T small muted>
        Export every diary entry (date, meal, food, amount and core nutrients) as a CSV file.
      </T>
      <Button title="Export diary (CSV)" onPress={() => void exportCsv()} />
    </Card>,
    <About key="about" />,
  ];

  if (!wide) return <Screen title="Settings">{cards}</Screen>;
  const left = cards.filter((_, i) => i % 2 === 0);
  const right = cards.filter((_, i) => i % 2 === 1);
  return (
    <Screen title="Settings" wide>
      <View style={{ flexDirection: 'row', gap: 16, alignItems: 'flex-start' }}>
        <View style={{ flex: 1, minWidth: 0 }}>{left}</View>
        <View style={{ flex: 1, minWidth: 0 }}>{right}</View>
      </View>
    </Screen>
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
  const [masked, setMasked] = useState<string | null | undefined>(undefined);
  const [draft, setDraft] = useState('');
  const [status, setStatus] = useState<ServerAiStatus | null | undefined>(undefined);

  useEffect(() => {
    if (account.server) void fetchServerAiStatus(account).then(setStatus);
    // Only the masked form is kept in memory for display.
    else void getApiKey().then((k) => setMasked(k ? maskApiKey(k) : null));
  }, [account]);

  const models = account.server && status?.models?.length ? AI_MODELS.filter((m) => status.models.includes(m.id)) : AI_MODELS;

  return (
    <Card>
      <T bold>AI meal logging</T>
      <Toggle
        label="Log meals from photos and descriptions"
        hint="Off by default. Uses Claude by Anthropic."
        value={prefs.aiEnabled}
        onChange={(v) => setPrefs({ aiEnabled: v })}
      />
      <Notice tone="warn">
        <T small>
          Privacy: when you use AI logging, the meal photo and description are sent to Anthropic{account.server ? ' via your server' : ''}. Nothing is sent
          while this is off.
        </T>
      </Notice>
      {prefs.aiEnabled && (
        <View>
          <T small muted style={{ marginTop: 6 }}>
            Model
          </T>
          {models.map((m) => (
            <ListRow
              key={m.id}
              title={m.label}
              subtitle={`About ${formatCost(typicalMealCostUsd(m.id))} per photo${m.id === 'claude-haiku-5-5' ? ' · cheapest' : m.id === 'claude-opus-5-5' ? ' · default' : ''}`}
              selected={prefs.aiModel === m.id}
              onPress={() => {
                haptic.tap();
                setPrefs({ aiModel: m.id });
              }}
            />
          ))}
          <T small muted style={{ marginTop: 6 }}>
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
          {account.server ? (
            <T small muted style={{ marginTop: 6 }}>
              {status === undefined
                ? 'Checking your server…'
                : status == null
                  ? 'Could not reach your server’s AI service.'
                  : status.enabled
                    ? `Your server provides AI${status.monthlyLimit ? ` (${status.usedThisMonth} of ${status.monthlyLimit} logs used this month)` : ''}. No key is needed on this phone.`
                    : 'AI is not configured on your server (it needs LLM_API_KEY).'}
            </T>
          ) : (
            <View style={{ marginTop: 8 }}>
              <T bold>Your Anthropic API key</T>
              <Notice>
                <T small>
                  Your key is stored only on this device (in the system keychain) and sent only to Anthropic. Create a dedicated key in a workspace with a monthly
                  spend limit in the Claude Console, so a lost phone can cost little and the key can be revoked on its own.
                </T>
              </Notice>
              {masked ? (
                <View style={styles.rowBetween}>
                  <T style={{ fontFamily: 'monospace' }}>{masked}</T>
                  <Button
                    small
                    variant="danger"
                    title="Remove key"
                    onPress={() =>
                      Alert.alert('Remove the API key from this phone?', undefined, [
                        { text: 'Cancel', style: 'cancel' },
                        {
                          text: 'Remove',
                          style: 'destructive',
                          onPress: () => {
                            void removeApiKey().then(() => setMasked(null));
                            toast('Key removed');
                          },
                        },
                      ])
                    }
                  />
                </View>
              ) : (
                <View>
                  <Input
                    value={draft}
                    onChangeText={setDraft}
                    placeholder="sk-ant-…"
                    secureTextEntry
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoComplete="off"
                    importantForAutofill="no"
                    textContentType="none"
                    accessibilityLabel="Anthropic API key"
                  />
                  {!!draft && !looksLikeAnthropicKey(draft) && (
                    <T small color={t.warn}>
                      Anthropic keys start with “sk-ant-”.
                    </T>
                  )}
                  <View style={[styles.row, { flexWrap: 'wrap' }]}>
                    <Button
                      title="Save key"
                      variant="primary"
                      disabled={!looksLikeAnthropicKey(draft)}
                      onPress={() => {
                        const k = draft.trim();
                        void setApiKey(k)
                          .then(() => {
                            setMasked(maskApiKey(k));
                            setDraft('');
                            toast('Key saved on this device');
                          })
                          .catch((e: Error) => Alert.alert('Could not save the key', e.message));
                      }}
                    />
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
      <T bold>About</T>
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
      {dbErr && (
        <T small color="#dc2626" style={{ marginTop: 4 }}>
          The bundled food database could not be opened: {dbErr}
        </T>
      )}
      <View style={[styles.row, { flexWrap: 'wrap' }]}>
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
  const items: { title: string; subtitle: string; tab: 'body' | 'foods' | 'settings' }[] = [
    { title: 'Weight & body', subtitle: 'Weigh-ins, trend, measurements', tab: 'body' },
    { title: 'Foods & recipes', subtitle: 'Custom foods, favourites, recipes, saved meals', tab: 'foods' },
    { title: 'Settings', subtitle: 'Targets, units, AI, server, export, about', tab: 'settings' },
  ];
  return (
    <Screen title="More">
      <Card style={{ paddingVertical: 4 }}>
        {items.map((i) => (
          <ListRow key={i.tab} title={i.title} subtitle={i.subtitle} onPress={() => nav.push({ name: i.tab })} right={<T color={t.muted}>›</T>} />
        ))}
      </Card>
    </Screen>
  );
}
