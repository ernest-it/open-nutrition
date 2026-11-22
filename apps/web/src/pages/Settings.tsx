import { useEffect, useRef, useState } from 'react';
import {
  ACTIVITY_FACTORS,
  AI_MODELS,
  ageFrom,
  bmrMifflinStJeor,
  computeTargets,
  CORE_NUTRIENTS,
  diaryToCsv,
  formatWeight,
  fromCm,
  fromKg,
  fromMl,
  N,
  OFF_ATTRIBUTION,
  tdee,
  toCm,
  toKg,
  toMl,
  typicalMealCostUsd,
  USDA_ATTRIBUTION,
  type ActivityLevel,
  type NutrientMap,
  type Prefs,
  type Profile,
} from '@open-nutrition/shared';
import { api, ApiError, errorMessage, loadAuth, setPrefs, usePrefs, useStore, store } from '../state';
import { getAiStatus, type AiStatus } from '../foodApi';
import { AiPrivacyNote, formatUsd, modelLabel } from './AiLog';
import { download, fmt, Icon, kcal, Modal, NumberInput, Segmented } from '../ui';
import { InlineError, Spinner, useConfirm, useToast } from '../feedback';

interface SessionInfo {
  id: string;
  name: string;
  createdAt: number;
  lastUsedAt: number;
  current: boolean;
}

export function SettingsPage({ username, onLogout, focus }: { username: string; onLogout: () => void; focus?: string }) {
  useEffect(() => {
    if (focus) document.getElementById(focus)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [focus]);
  return (
    <div className="page narrow">
      <header className="page-head">
        <h1>Settings</h1>
      </header>
      <nav className="settings-toc" aria-label="Settings sections">
        {[
          ['targets', 'Targets'],
          ['units', 'Units'],
          ['ai', 'AI'],
          ['data', 'Data'],
          ['account', 'Account'],
          ['about', 'About'],
        ].map(([id, l]) => (
          <a key={id} href={`#/settings/${id}`}>
            {l}
          </a>
        ))}
      </nav>
      <TargetsSection />
      <UnitsSection />
      <AiSection />
      <DataSection />
      <AccountSection username={username} onLogout={onLogout} />
      <AboutSection />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Profile & targets
// ---------------------------------------------------------------------------

const ACTIVITY_LABEL: Record<ActivityLevel, string> = {
  sedentary: 'Mostly sitting (desk job, little exercise)',
  light: 'Lightly active (walks, exercise 1–3×/week)',
  moderate: 'Moderately active (exercise 3–5×/week)',
  active: 'Very active (hard exercise 6–7×/week)',
  very_active: 'Athlete or physical job',
};

const GOAL_RATES_KG = [-1, -0.75, -0.5, -0.25, 0, 0.25, 0.5];

const DEFAULT_PROFILE: Profile = {
  sex: 'female',
  birthYear: new Date().getFullYear() - 35,
  heightCm: 168,
  activity: 'light',
  goalKgPerWeek: -0.25,
  proteinGPerKg: null,
  macroSplit: { protein: 25, carbs: 45, fat: 30 },
};

const TARGET_ROWS = CORE_NUTRIENTS;

function TargetsSection() {
  const s = useStore();
  const prefs = usePrefs();
  const saved = s.profile();
  const current = s.targetsOn(s.today());
  const [p, setP] = useState<Profile>(saved ?? DEFAULT_PROFILE);
  const [weightKg, setWeightKg] = useState<number | null>(s.latestWeightKg());
  const [draft, setDraft] = useState<NutrientMap>(current?.nutrients ?? {});
  const [waterMl, setWaterMl] = useState<number | null>(current?.waterMl ?? 2000);
  const [msg, setMsg] = useState<string | null>(null);
  const toast = useToast();
  // Until the user edits, follow what the store has (the first sync may land after this page mounts).
  const dirty = useRef(false);
  const latestKg = s.latestWeightKg();
  useEffect(() => {
    if (dirty.current) return;
    setP(saved ?? DEFAULT_PROFILE);
    setWeightKg(latestKg);
    setDraft(current?.nutrients ?? {});
    setWaterMl(current?.waterMl ?? 2000);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id, current?.updatedAt, s.get('settings', 'profile')?.updatedAt, latestKg]);
  const wu = prefs.weightUnit;
  const lu = prefs.lengthUnit;
  const split = p.macroSplit;
  const splitSum = split.protein + split.carbs + split.fat;
  const age = ageFrom(p.birthYear);
  const canCalc = weightKg != null && weightKg > 0 && p.heightCm > 0 && age > 0 && age < 120 && (p.proteinGPerKg != null || splitSum === 100);

  function calculate() {
    if (!canCalc) return;
    dirty.current = true;
    setDraft(computeTargets(p, weightKg!));
    setMsg('Suggested targets are filled in below. Adjust anything you like, then save.');
  }

  function save() {
    s.setSetting('profile', p);
    if (weightKg && weightKg > 0) {
      const latest = s.latestWeightKg();
      if (latest == null || Math.abs(latest - weightKg) > 0.05) s.addMeasurement('body_weight', weightKg);
    }
    const clean = Object.fromEntries(Object.entries(draft).filter(([, v]) => Number.isFinite(v) && v >= 0));
    s.setTargets(clean, waterMl);
    dirty.current = false;
    setMsg(null);
    toast({ message: 'Targets saved. They apply from today; past days keep the targets they had.', tone: 'success' });
  }

  const setDraftKey = (k: string, v: number | null) =>
    setDraft((d) => {
      const next = { ...d };
      if (v == null) delete next[k];
      else next[k] = v;
      return next;
    });

  return (
    <section className="card settings-section" id="targets" onChangeCapture={() => (dirty.current = true)}>
      <h2>Profile &amp; targets</h2>
      <p className="muted small">
        Calories use the Mifflin-St Jeor equation × your activity level, adjusted for your goal. Vitamins and minerals default to the US
        Dietary Reference Intakes for your age and sex. Every number is yours to change.
      </p>
      <div className="form-grid">
        <label>
          Sex (for the energy equation)
          <select value={p.sex} onChange={(e) => setP({ ...p, sex: e.target.value as Profile['sex'] })}>
            <option value="female">Female</option>
            <option value="male">Male</option>
          </select>
        </label>
        <label>
          Birth year
          <NumberInput value={p.birthYear} onChange={(v) => v && setP({ ...p, birthYear: Math.round(v) })} />
        </label>
        <label>
          Height ({lu})
          <NumberInput value={+fromCm(p.heightCm, lu).toFixed(1)} onChange={(v) => v && setP({ ...p, heightCm: toCm(v, lu) })} />
        </label>
        <label>
          Current weight ({wu})
          <NumberInput value={weightKg != null ? +fromKg(weightKg, wu).toFixed(1) : null} onChange={(v) => setWeightKg(v ? toKg(v, wu) : null)} />
        </label>
        <label className="span-2">
          Activity
          <select value={p.activity} onChange={(e) => setP({ ...p, activity: e.target.value as ActivityLevel })}>
            {(Object.keys(ACTIVITY_FACTORS) as ActivityLevel[]).map((a) => (
              <option key={a} value={a}>
                {ACTIVITY_LABEL[a]}
              </option>
            ))}
          </select>
        </label>
        <label className="span-2">
          Goal
          <select value={p.goalKgPerWeek} onChange={(e) => setP({ ...p, goalKgPerWeek: Number(e.target.value) })}>
            {[...new Set([...GOAL_RATES_KG, p.goalKgPerWeek])].sort((a, b) => a - b).map((r) => (
              <option key={r} value={r}>
                {r === 0 ? 'Maintain weight' : `${r < 0 ? "Lose" : "Gain"} ${fmt(fromKg(Math.abs(r), wu), 2)} ${wu} per week`}
              </option>
            ))}
          </select>
        </label>
        <label>
          Protein (g per kg body weight, optional)
          <NumberInput value={p.proteinGPerKg} onChange={(v) => setP({ ...p, proteinGPerKg: v && v > 0 ? v : null })} placeholder="e.g. 1.6" />
        </label>
        <fieldset className="split-inputs">
          <legend>Calories from protein / carbs / fat (%)</legend>
          {(['protein', 'carbs', 'fat'] as const).map((k) => (
            <NumberInput
              key={k}
              value={split[k]}
              ariaLabel={`${k} percent`}
              onChange={(v) => setP({ ...p, macroSplit: { ...split, [k]: v ?? 0 } })}
            />
          ))}
        </fieldset>
        {/* Help sits under the whole row so the g/kg input and the % inputs line up. */}
        <small className={`form-note ${splitSum === 100 || p.proteinGPerKg != null ? 'muted' : 'error'}`}>
          {p.proteinGPerKg != null ? 'Protein set by g/kg; carbs and fat share the rest in this ratio.' : `Macro split total ${splitSum}% (must be 100)`}
        </small>
      </div>
      {canCalc && (
        <p className="muted small">
          Resting energy ≈ {kcal(bmrMifflinStJeor(p, weightKg!, age))} kcal · maintenance ≈ {kcal(tdee(p, weightKg!, age))} kcal/day
        </p>
      )}
      {!canCalc && <p className="muted small">Fill in your height, weight and birth year{p.proteinGPerKg == null && splitSum !== 100 ? ', and make the macro split add up to 100%' : ''} to get suggestions.</p>}
      <button className="block" disabled={!canCalc} onClick={calculate}>
        Suggest targets
      </button>

      <h3>Daily targets</h3>
      <div className="target-grid">
        {TARGET_ROWS.map((n) => (
          <label key={n.key}>
            <span>
              {n.name} <small>{n.unit}{n.limit ? ', max' : ''}</small>
            </span>
            <NumberInput value={draft[n.key] != null ? +draft[n.key]!.toFixed(n.unit === 'kcal' ? 0 : 1) : null} onChange={(v) => setDraftKey(n.key, v)} />
          </label>
        ))}
        <label>
          <span>
            Water <small>{prefs.waterUnit === 'ml' ? 'ml' : 'fl oz'}</small>
          </span>
          <NumberInput
            value={waterMl != null ? +fromMl(waterMl, prefs.waterUnit).toFixed(0) : null}
            onChange={(v) => setWaterMl(v != null ? Math.round(toMl(v, prefs.waterUnit)) : null)}
          />
        </label>
      </div>
      {draft[N.energy] != null && (
        <p className="muted small">
          Macros add up to {kcal((draft[N.protein] ?? 0) * 4 + (draft[N.carbs] ?? 0) * 4 + (draft[N.fat] ?? 0) * 9)} kcal of your{' '}
          {kcal(draft[N.energy])} kcal budget.
        </p>
      )}
      {msg && (
        <p className="note" role="status">
          {msg}
        </p>
      )}
      <button className="primary block" onClick={save} disabled={draft[N.energy] == null}>
        Save profile &amp; targets
      </button>
    </section>
  );
}

// ---------------------------------------------------------------------------

function UnitsSection() {
  const prefs = usePrefs();
  return (
    <section className="card settings-section" id="units">
      <h2>Units</h2>
      <div className="unit-rows">
        <div className="unit-row">
          <span>Body weight</span>
          <Segmented value={prefs.weightUnit} onChange={(v) => setPrefs({ weightUnit: v })} options={[['kg', 'kg'], ['lb', 'lb']]} label="Weight unit" />
        </div>
        <div className="unit-row">
          <span>Height &amp; measurements</span>
          <Segmented value={prefs.lengthUnit} onChange={(v) => setPrefs({ lengthUnit: v })} options={[['cm', 'cm'], ['in', 'in']]} label="Length unit" />
        </div>
        <div className="unit-row">
          <span>Water</span>
          <Segmented value={prefs.waterUnit} onChange={(v) => setPrefs({ waterUnit: v })} options={[['ml', 'ml'], ['floz', 'fl oz']]} label="Water unit" />
        </div>
      </div>
      <p className="muted small">Food is always weighed in grams. Your data is stored in metric, so switching units never changes it.</p>
    </section>
  );
}

// ---------------------------------------------------------------------------

function AiSection() {
  const prefs = usePrefs();
  const [status, setStatus] = useState<AiStatus | null>(null);
  useEffect(() => {
    void getAiStatus(true).then(setStatus);
  }, []);
  const models = AI_MODELS.filter((m) => !status?.models.length || status.models.includes(m.id));
  return (
    <section className="card settings-section" id="ai">
      <h2>AI meal logging</h2>
      {!status ? (
        <p className="muted">Checking the server…</p>
      ) : !status.enabled ? (
        <p className="note">
          AI meal logging isn't set up on this server. The server admin can enable it by adding an Anthropic API key to the server's
          configuration. Keys are never entered or stored in the browser.
        </p>
      ) : (
        <>
          <label className="switch">
            <input type="checkbox" checked={prefs.aiEnabled} onChange={(e) => setPrefs({ aiEnabled: e.target.checked })} />
            <span>Show “Photo / describe” when adding food</span>
          </label>
          <div className="form-grid stack-sm">
            <label>
              Model
              <select value={prefs.aiModel} onChange={(e) => setPrefs({ aiModel: e.target.value })}>
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label.split(' — ')[0]} · ~{formatUsd(typicalMealCostUsd(m.id))}/meal
                  </option>
                ))}
              </select>
            </label>
            <label>
              Effort
              <select value={prefs.aiEffort} onChange={(e) => setPrefs({ aiEffort: e.target.value as Prefs['aiEffort'] })}>
                <option value="low">Low (fastest, cheapest)</option>
                <option value="medium">Medium</option>
                <option value="high">High (slowest)</option>
              </select>
            </label>
          </div>
          <p className="muted small">
            {AI_MODELS.find((m) => m.id === prefs.aiModel)?.label ?? modelLabel(prefs.aiModel)}: roughly {formatUsd(typicalMealCostUsd(prefs.aiModel))} per meal. Costs are paid by whoever runs
            this server{status.monthlyLimit > 0 ? `; your account can make ${status.monthlyLimit} estimates a month` : ''}.
            {status.monthlyLimit > 0 && ` Used this month: ${status.usedThisMonth}.`}
          </p>
          <AiPrivacyNote />
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------

function DataSection() {
  const s = useStore();
  const toast = useToast();
  const [backingUp, setBackingUp] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const pending = s.pendingCount();
  return (
    <section className="card settings-section" id="data">
      <h2>Your data</h2>
      <div className="row">
        <button
          onClick={() => {
            const entries = s.all('diaryEntries');
            download(`open-nutrition-diary-${s.today()}.csv`, diaryToCsv(entries), 'text/csv');
            toast({ message: `Exported ${entries.length.toLocaleString()} diary ${entries.length === 1 ? 'entry' : 'entries'}.`, tone: 'success' });
          }}
        >
          Export diary (CSV)
        </button>
        <button
          disabled={backingUp}
          onClick={async () => {
            const auth = loadAuth();
            setBackingUp(true);
            try {
              const res = await fetch(`${auth?.baseUrl ?? ''}/api/v1/export/json`, { headers: { authorization: `Bearer ${auth?.token ?? ''}` } });
              if (!res.ok) throw new Error(`HTTP ${res.status}`);
              download(`open-nutrition-backup-${s.today()}.json`, await res.blob());
              toast({ message: 'Backup downloaded.', tone: 'success' });
            } catch (e) {
              toast({ message: `Backup failed: ${errorMessage(e)}`, tone: 'error' });
            } finally {
              setBackingUp(false);
            }
          }}
        >
          {backingUp ? (
            <>
              <Spinner /> Preparing backup…
            </>
          ) : (
            'Full backup (JSON)'
          )}
        </button>
      </div>
      <h3>Sync</h3>
      <p className="muted small">
        {pending ? `${pending.toLocaleString()} change${pending === 1 ? '' : 's'} waiting to sync` : 'Everything is synced'} · last synced{' '}
        {s.lastSyncAt ? new Date(s.lastSyncAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : 'not yet'}
      </p>
      <InlineError>{s.lastSyncError}</InlineError>
      <button
        disabled={syncing}
        onClick={async () => {
          setSyncing(true);
          try {
            await s.sync();
            toast({ message: 'Synced with the server.', tone: 'success' });
          } catch (e) {
            toast({ message: `Sync failed: ${errorMessage(e)}`, tone: 'error' });
          } finally {
            setSyncing(false);
          }
        }}
      >
        {syncing ? (
          <>
            <Spinner /> Syncing…
          </>
        ) : (
          'Sync now'
        )}
      </button>
    </section>
  );
}

// ---------------------------------------------------------------------------

const fmtTime = (t: number) => new Date(t).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

function AccountSection({ username, onLogout }: { username: string; onLogout: () => void }) {
  const ask = useConfirm();
  const toast = useToast();
  const [sessions, setSessions] = useState<SessionInfo[] | null>(null);
  const [sessError, setSessError] = useState<string | null>(null);
  const [tokenOpen, setTokenOpen] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [pw, setPw] = useState({ current: '', next: '' });
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwBusy, setPwBusy] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const mounted = useRef(true);

  const loadSessions = () =>
    api<SessionInfo[]>('/api/v1/sessions')
      .then((x) => mounted.current && (setSessions(x), setSessError(null)))
      .catch((e) => mounted.current && (setSessions((cur) => cur ?? []), setSessError(errorMessage(e))));
  useEffect(() => {
    mounted.current = true;
    void loadSessions();
    return () => {
      mounted.current = false;
    };
  }, []);

  async function revoke(x: SessionInfo) {
    const ok = await ask({
      title: 'Sign out this device?',
      body: (
        <>
          “{x.name}” will be signed out and has to sign in again. If it is an API token, scripts using it stop working.
        </>
      ),
      confirmLabel: 'Sign out device',
      destructive: true,
    });
    if (!ok) return;
    setRevoking(x.id);
    try {
      await api(`/api/v1/sessions/${x.id}`, { method: 'DELETE' });
      toast({ message: `Signed out “${x.name}”.`, tone: 'success' });
      await loadSessions();
    } catch (e) {
      toast({ message: `Couldn't sign out that device: ${errorMessage(e)}`, tone: 'error' });
    } finally {
      setRevoking(null);
    }
  }

  async function signOut() {
    setSigningOut(true);
    await store.sync().catch(() => {});
    const unsynced = store.pendingCount();
    setSigningOut(false);
    const ok = await ask({
      title: 'Sign out?',
      body: unsynced ? (
        <>
          <strong>
            {unsynced} change{unsynced === 1 ? " hasn't" : "s haven't"} reached the server yet
          </strong>{' '}
          and will be lost if you sign out now. Check your connection and try “Sync now” first.
        </>
      ) : (
        'Your diary stays on the server. Sign in again any time to pick up where you left off.'
      ),
      confirmLabel: unsynced ? 'Sign out anyway' : 'Sign out',
      destructive: unsynced > 0,
    });
    if (!ok) return;
    setSigningOut(true);
    await api('/api/v1/auth/logout', { method: 'POST' }).catch(() => {});
    await store.reset();
    onLogout();
  }

  return (
    <section className="card settings-section" id="account">
      <h2>Account</h2>
      <p>
        Signed in as <strong>{username}</strong>
      </p>

      <h3>Devices &amp; sessions</h3>
      <InlineError>{sessError}</InlineError>
      {sessions == null ? (
        <p className="muted small">
          <Spinner /> Loading devices…
        </p>
      ) : (
        sessions.length > 0 && (
          <ul className="list">
            {sessions.map((x) => (
              <li key={x.id} className="list-row">
                <span className="grow min0">
                  <span className="session-name">
                    <span className="ellipsis">{x.name}</span>
                    {x.current && <span className="badge">this device</span>}
                  </span>
                  <small className="muted">Last used {fmtTime(x.lastUsedAt)}</small>
                </span>
                {!x.current && (
                  <button className="small danger" disabled={revoking === x.id} onClick={() => void revoke(x)}>
                    {revoking === x.id ? <Spinner /> : null} Sign out
                  </button>
                )}
              </li>
            ))}
          </ul>
        )
      )}
      <button className="small" onClick={() => setTokenOpen(true)}>
        <Icon name="plus" size={16} /> Create API token
      </button>
      {tokenOpen && (
        <TokenDialog
          onClose={() => setTokenOpen(false)}
          onCreated={() => void loadSessions()}
        />
      )}

      <h3>Change password</h3>
      <form
        className="form-grid"
        onSubmit={async (e) => {
          e.preventDefault();
          if (pwBusy) return;
          setPwError(null);
          if (pw.next.length < 8) return setPwError('The new password needs at least 8 characters.');
          setPwBusy(true);
          try {
            await api('/api/v1/auth/password', { method: 'POST', body: JSON.stringify({ currentPassword: pw.current, newPassword: pw.next }) });
            setPw({ current: '', next: '' });
            toast({ message: 'Password changed. Other devices were signed out.', tone: 'success' });
            void loadSessions();
          } catch (err) {
            setPwError(err instanceof ApiError && err.status === 401 ? 'The current password is wrong.' : errorMessage(err));
          } finally {
            setPwBusy(false);
          }
        }}
      >
        <label>
          Current password
          <input
            type="password"
            autoComplete="current-password"
            value={pw.current}
            onChange={(e) => setPw({ ...pw, current: e.target.value })}
            required
          />
        </label>
        <label>
          New password
          <input
            type="password"
            autoComplete="new-password"
            minLength={8}
            value={pw.next}
            onChange={(e) => setPw({ ...pw, next: e.target.value })}
            placeholder="At least 8 characters"
            required
          />
        </label>
        {pwError && <InlineError className="span-2">{pwError}</InlineError>}
        <button type="submit" className="span-2" disabled={pwBusy || !pw.current || !pw.next}>
          {pwBusy ? (
            <>
              <Spinner /> Changing…
            </>
          ) : (
            'Change password'
          )}
        </button>
      </form>

      <button className="danger block" disabled={signingOut} onClick={() => void signOut()}>
        {signingOut ? (
          <>
            <Spinner /> Signing out…
          </>
        ) : (
          'Sign out'
        )}
      </button>
    </section>
  );
}

function TokenDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function create(e?: React.FormEvent) {
    e?.preventDefault();
    if (busy || !name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ token: string }>('/api/v1/tokens', { method: 'POST', body: JSON.stringify({ name: name.trim() }) });
      setToken(r.token);
      onCreated();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={token ? 'Your new API token' : 'Create API token'}
      variant="compact"
      onClose={onClose}
      footer={
        token ? (
          <>
            <span className="spacer" />
            <button className="primary" onClick={onClose}>
              Done
            </button>
          </>
        ) : (
          <>
            <span className="spacer" />
            <button onClick={onClose}>Cancel</button>
            <button className="primary" disabled={busy || !name.trim()} onClick={() => void create()}>
              {busy ? (
                <>
                  <Spinner /> Creating…
                </>
              ) : (
                'Create token'
              )}
            </button>
          </>
        )
      }
    >
      {token ? (
        <>
          <p className="note">Copy it now. For your security it won't be shown again.</p>
          <div className="token-box">
            <code>{token}</code>
            <button
              className="small"
              data-autofocus
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(token);
                  setCopied(true);
                } catch {
                  setCopied(false);
                }
              }}
            >
              <Icon name={copied ? 'check' : 'copy'} size={16} /> {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <p className="muted small">
            Send it as <code>Authorization: Bearer …</code>. You can revoke it any time under Devices &amp; sessions.
          </p>
        </>
      ) : (
        <form onSubmit={create}>
          <p className="muted small">API tokens let scripts and other tools (like the MCP endpoint) read and write your diary.</p>
          <label>
            Name
            <input
              autoFocus
              value={name}
              maxLength={100}
              placeholder="e.g. backup script"
              onChange={(e) => setName(e.target.value)}
              aria-invalid={!!error}
            />
          </label>
          <InlineError>{error}</InlineError>
        </form>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------------------

function AboutSection() {
  return (
    <section className="card settings-section" id="about">
      <h2>About</h2>
      <p className="small">
        Open Nutrition is source-available under the{' '}
        <a href="https://polyformproject.org/licenses/noncommercial/1.0.0" target="_blank" rel="noreferrer">
          PolyForm Noncommercial License 1.0.0
        </a>
        : free for personal and other non-commercial use. See the{' '}
        <a href="/third-party-notices.txt" target="_blank" rel="noreferrer">
          third-party notices
        </a>
        .
      </p>
      <h3>Food data</h3>
      <p className="small">
        {USDA_ATTRIBUTION}{' '}
        <a href="https://fdc.nal.usda.gov/" target="_blank" rel="noreferrer">
          fdc.nal.usda.gov
        </a>
      </p>
      <p className="small">
        {OFF_ATTRIBUTION}{' '}
        <a href="https://world.openfoodfacts.org/" target="_blank" rel="noreferrer">
          openfoodfacts.org
        </a>{' '}
        ·{' '}
        <a href="https://opendatacommons.org/licenses/odbl/1-0/" target="_blank" rel="noreferrer">
          ODbL 1.0
        </a>{' '}
        ·{' '}
        <a href="https://opendatacommons.org/licenses/dbcl/1-0/" target="_blank" rel="noreferrer">
          DbCL 1.0
        </a>
      </p>
      <p className="muted small">
        Nutrition numbers are estimates. Open Nutrition is not medical advice; talk to a professional before making big changes to your
        diet, especially below the suggested calorie floors.
      </p>
    </section>
  );
}
