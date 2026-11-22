import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Icon } from './icons';
import { discardLocalData, localDataSummary, moveLocalDataToAccount, useAccount, type LocalDataSummary } from './state';
import { Banner, Button, Card, Screen, T, haptic, styles, useConfirm, useTheme, useToast } from './ui';

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

/** "42 diary entries over 15 days, 60 measurements, 3 foods and 2 other items". */
export function describeLocalData(s: LocalDataSummary): string {
  const parts: string[] = [];
  if (s.entries) parts.push(`${plural(s.entries, 'diary entry', 'diary entries')} over ${plural(s.days, 'day')}`);
  if (s.measurements) parts.push(plural(s.measurements, 'measurement'));
  if (s.foods) parts.push(plural(s.foods, 'saved food'));
  if (s.other) parts.push(plural(s.other, 'other item'));
  return parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0] ?? '';
}

function useMove(onDone: () => void) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function move() {
    setBusy(true);
    setError(null);
    try {
      const { moved, uploaded } = await moveLocalDataToAccount();
      if (uploaded) {
        haptic.success();
        toast({ message: moved ? `Moved ${plural(moved, 'item')} to your account` : 'Your account already had all of it', tone: 'success' });
        onDone();
      } else {
        setError('Your data is in the app, but it has not reached the server yet. It will upload on the next sync; the copy from local mode is kept until it does.');
      }
    } catch (e) {
      setError((e as Error).message || 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }
  return { move, busy, error, clearError: () => setError(null) };
}

/** Shown right after signing in from local-only mode, before anything else. */
export function MoveLocalDataScreen({ summary, onDone }: { summary: LocalDataSummary; onDone: () => void }) {
  const t = useTheme();
  const account = useAccount();
  const { move, busy, error, clearError } = useMove(onDone);
  const host = account.server?.baseUrl.replace(/^https?:\/\//, '') ?? 'your server';
  return (
    <Screen>
      <View style={[styles.row, { gap: 12, marginTop: 8, marginBottom: 4 }]}>
        <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: t.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="cloud" size={24} color={t.accent} />
        </View>
        <T bold accessibilityRole="header" style={{ fontSize: 22, flexShrink: 1 }}>
          Bring your data along?
        </T>
      </View>
      <Card>
        <T>
          This phone has {describeLocalData(summary)} from local-only mode. Move it into {account.server?.username ?? 'this account'} on {host} so it syncs and is backed up.
        </T>
        <T small muted style={{ marginTop: 6 }}>
          If the account already has data, both are kept. Where the same setting exists in both, the most recent change wins.
        </T>
        {error && <Banner tone="error" title="Not uploaded yet" message={error} onDismiss={clearError} />}
        <Button title="Move my data" variant="primary" icon="cloud" onPress={() => void move()} loading={busy} />
        <Button title={error ? 'Continue' : 'Not now'} onPress={onDone} disabled={busy} />
        <T small muted>
          {error ? 'You can try again from Settings.' : 'You can still move it later from Settings. It stays on this phone until then.'}
        </T>
      </Card>
    </Screen>
  );
}

/** Settings card while local-only data is still waiting to be moved (server mode only). */
export function LocalDataCard() {
  const t = useTheme();
  const account = useAccount();
  const confirm = useConfirm();
  const toast = useToast();
  const [summary, setSummary] = useState<LocalDataSummary | null>(null);
  const refresh = () => void localDataSummary().then(setSummary);
  useEffect(refresh, [account]);
  const { move, busy, error, clearError } = useMove(refresh);
  if (!account.server || !summary) return null;

  async function discard() {
    const ok = await confirm({
      title: 'Delete local-only data?',
      message: `${describeLocalData(summary!)} will be removed from this phone. Your account is not affected.`,
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    await discardLocalData();
    haptic.light();
    toast('Local-only data deleted');
    refresh();
  }

  return (
    <Card>
      <View style={[styles.row, { marginBottom: 6 }]}>
        <Icon name="cloud" size={18} color={t.accent} />
        <T bold style={{ fontSize: 16 }} accessibilityRole="header">
          Data from local mode
        </T>
      </View>
      <T small muted>
        {describeLocalData(summary)} from before you connected are still only on this phone.
      </T>
      {error && <Banner tone="error" title="Not uploaded yet" message={error} onDismiss={clearError} />}
      <Button title="Move to this account" variant="primary" icon="cloud" onPress={() => void move()} loading={busy} />
      <Button title="Delete it" variant="ghost" onPress={() => void discard()} disabled={busy} />
    </Card>
  );
}
