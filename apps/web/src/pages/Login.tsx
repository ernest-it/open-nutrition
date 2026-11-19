import { useEffect, useState } from 'react';
import type { Auth } from '../state';
import { InlineError, Spinner } from '../feedback';

export function Login({ onLogin }: { onLogin: (a: Auth) => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState<{ registrationOpen: boolean; version: string } | null>(null);
  const baseUrl = '';

  useEffect(() => {
    document.title = 'Sign in · Open Nutrition';
    fetch(`${baseUrl}/api/v1/server-info`)
      .then((r) => r.json())
      .then(setInfo)
      .catch(() => setError('Cannot reach the server. Check that it is running and try again.'));
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError(null);
    setBusy(true);
    let res: Response;
    try {
      res = await fetch(`${baseUrl}/api/v1/auth/${mode}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password, deviceName: `Web (${navigator.userAgent.split(') ')[0]?.split('(')[1] ?? 'browser'})` }),
      });
    } catch {
      setBusy(false);
      setError('Cannot reach the server. Check your connection and try again.');
      return;
    }
    const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    if (!res.ok) {
      setBusy(false);
      if (res.status === 401) setError('Wrong username or password.');
      else if (res.status === 429) setError('Too many attempts. Wait a minute and try again.');
      else
        setError(
          body?.issues
            ? body.issues.map((i: { path: string[]; message: string }) => `${i.path.join('.') || 'Input'}: ${i.message}`).join(' ')
            : (body?.message ?? body?.error ?? `Something went wrong (HTTP ${res.status}).`),
        );
      return;
    }
    onLogin({ token: body.token, username: body.user.username, baseUrl });
  }

  return (
    <main className="login">
      <form className="card login-card" onSubmit={submit} aria-busy={busy}>
        <img src="/icon.svg" alt="" width={48} height={48} />
        <h1>Open Nutrition</h1>
        <p className="muted">{mode === 'login' ? 'Sign in to your server to see your food diary.' : 'Create an account on this server.'}</p>
        <label>
          Username
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            autoFocus
            required
          />
        </label>
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            minLength={mode === 'register' ? 8 : 1}
            placeholder={mode === 'register' ? 'At least 8 characters' : undefined}
            required
          />
        </label>
        <InlineError>{error}</InlineError>
        <button className="primary" type="submit" disabled={busy}>
          {busy ? (
            <>
              <Spinner /> {mode === 'login' ? 'Signing in…' : 'Creating account…'}
            </>
          ) : mode === 'login' ? (
            'Sign in'
          ) : (
            'Create account'
          )}
        </button>
        {info?.registrationOpen && (
          <button
            type="button"
            className="ghost"
            onClick={() => {
              setMode(mode === 'login' ? 'register' : 'login');
              setError(null);
            }}
          >
            {mode === 'login' ? 'Need an account? Register' : 'Have an account? Sign in'}
          </button>
        )}
        {info && <p className="muted small">Server v{info.version}</p>}
      </form>
    </main>
  );
}
