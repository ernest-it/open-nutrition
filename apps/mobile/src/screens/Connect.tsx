import { useRef, useState, type ComponentRef } from 'react';
import { Platform, TextInput, View } from 'react-native';
import { Icon } from '../icons';
import { normalizeServerUrl, type Account } from '../state';
import { Banner, Button, Card, Input, Screen, T, styles, useTheme } from '../ui';

/** Parse a JSON body without surfacing "JSON Parse error: Unexpected character" to people. */
async function readJson(res: Response): Promise<Record<string, unknown> | null> {
  try {
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** First-run screen: connect to a self-hosted server, or use the app locally. */
export function ConnectScreen({ onDone }: { onDone: (a: Account) => void }) {
  const t = useTheme();
  const [url, setUrl] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState<'check' | 'login' | 'register' | null>(null);
  const [error, setError] = useState<{ title: string; message: string } | null>(null);
  const [info, setInfo] = useState<{ registrationOpen: boolean; version: string } | null>(null);
  const passwordRef = useRef<ComponentRef<typeof TextInput>>(null);

  async function check() {
    if (!url.trim() || busy) return;
    setError(null);
    setBusy('check');
    const base = normalizeServerUrl(url);
    try {
      const res = await fetch(`${base}/api/v1/server-info`);
      const body = await readJson(res);
      if (!body || body.name !== 'open-nutrition') throw new Error('That address answered, but it is not an Open Nutrition server.');
      setInfo({ registrationOpen: !!body.registrationOpen, version: String(body.version ?? '') });
    } catch (e) {
      const msg = (e as Error).message;
      // An http-only server reached over https fails with an opaque TLS error; say what to try.
      const hint = /SSL|TLS|certificate/i.test(msg) ? ' If your server has no HTTPS, start the address with http://' : '';
      setError({ title: `Could not connect to ${base.replace(/^https?:\/\//, '')}`, message: `${msg}${hint}` });
    } finally {
      setBusy(null);
    }
  }

  async function auth(mode: 'login' | 'register') {
    if (busy) return;
    setError(null);
    setBusy(mode);
    try {
      const baseUrl = normalizeServerUrl(url);
      const res = await fetch(`${baseUrl}/api/v1/auth/${mode}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password, deviceName: `${Platform.OS} app` }),
      });
      const body = (await readJson(res)) as { token?: string; user?: { username: string }; error?: string; issues?: { message: string }[] } | null;
      if (!res.ok || !body?.token || !body.user) {
        throw new Error(body?.issues?.map((i) => i.message).join(', ') || body?.error || `The server answered with HTTP ${res.status}.`);
      }
      onDone({ server: { baseUrl, token: body.token, username: body.user.username } });
    } catch (e) {
      setError({ title: mode === 'login' ? 'Could not sign in' : 'Could not create the account', message: (e as Error).message });
      setBusy(null);
    }
  }

  const canLogin = !!username.trim() && !!password;
  return (
    <Screen title="Open Nutrition">
      <T muted>Track what you eat, privately. Use the app on its own, or sync with your own server: the phone keeps working offline and syncs when it can reach it.</T>
      <Card style={{ marginTop: 16 }}>
        <Input
          label="Server address"
          value={url}
          onChangeText={(v) => {
            setUrl(v);
            setInfo(null);
            setError(null);
          }}
          placeholder="192.168.1.10:8080 or nutrition.example.com"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          returnKeyType="go"
          onSubmitEditing={() => void check()}
        />
        {!info && <Button title="Connect" variant="primary" onPress={() => void check()} disabled={!url.trim()} loading={busy === 'check'} />}
        {info && (
          <View>
            <View style={[styles.row, { marginVertical: 4 }]}>
              <Icon name="check" size={16} color={t.success} />
              <T small color={t.success}>
                Connected{info.version ? ` · server v${info.version}` : ''}
              </T>
            </View>
            <Input
              label="Username"
              value={username}
              onChangeText={setUsername}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="username"
              textContentType="username"
              returnKeyType="next"
              onSubmitEditing={() => passwordRef.current?.focus()}
            />
            <Input
              ref={passwordRef}
              label="Password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoComplete="current-password"
              textContentType="password"
              returnKeyType="go"
              onSubmitEditing={() => canLogin && void auth('login')}
            />
            <Button title="Sign in" variant="primary" onPress={() => void auth('login')} disabled={!canLogin || (!!busy && busy !== 'login')} loading={busy === 'login'} />
            {info.registrationOpen && (
              <>
                <Button
                  title="Create account"
                  onPress={() => void auth('register')}
                  disabled={!username.trim() || password.length < 8 || (!!busy && busy !== 'register')}
                  loading={busy === 'register'}
                />
                {!!password && password.length < 8 && (
                  <T small muted>
                    New accounts need a password of at least 8 characters.
                  </T>
                )}
              </>
            )}
          </View>
        )}
        {error && <Banner tone="error" title={error.title} message={error.message} onDismiss={() => setError(null)} />}
      </Card>
      <Button title="Use on this phone only (no server)" onPress={() => onDone({ server: null })} disabled={!!busy} />
    </Screen>
  );
}
