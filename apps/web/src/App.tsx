import { useCallback, useEffect, useState } from 'react';
import { navigate, useRoute } from './router';
import { initStore, loadAuth, saveAuth, useStore, type Auth } from './state';
import { AddFoodContext, type AddRequest } from './addFood';
import { FeedbackProvider, Spinner } from './feedback';
import { Icon, mealForNow, type IconName } from './ui';
import { Login } from './pages/Login';
import { TodayPage } from './pages/Today';
import { DiaryPage } from './pages/Diary';
import { FoodsPage } from './pages/Foods';
import { NutrientsPage } from './pages/Nutrients';
import { BodyPage } from './pages/Body';
import { SettingsPage } from './pages/Settings';
import { AddFoodSheet } from './pages/AddFood';

const TABS: [string, string, IconName][] = [
  ['today', 'Today', 'today'],
  ['diary', 'Diary', 'diary'],
  ['foods', 'Foods', 'foods'],
  ['nutrients', 'Nutrients', 'report'],
  ['body', 'Body', 'body'],
  ['settings', 'Settings', 'settings'],
];

export function App() {
  return (
    <FeedbackProvider>
      <Root />
    </FeedbackProvider>
  );
}

function Root() {
  const [auth, setAuth] = useState<Auth | null>(loadAuth);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!auth) return;
    setReady(false);
    void initStore(auth).then(() => setReady(true));
  }, [auth]);

  if (!auth)
    return (
      <Login
        onLogin={(a) => {
          saveAuth(a);
          setAuth(a);
          navigate('today');
        }}
      />
    );
  if (!ready)
    return (
      <div className="loading" role="status">
        <span>
          <Spinner /> Loading your diary…
        </span>
      </div>
    );
  return (
    <Shell
      auth={auth}
      onLogout={() => {
        saveAuth(null);
        setAuth(null);
        document.title = 'Open Nutrition';
      }}
    />
  );
}

function Shell({ auth, onLogout }: { auth: Auth; onLogout: () => void }) {
  const store = useStore();
  const [section = 'today', ...rest] = useRoute();
  const [add, setAdd] = useState<AddRequest | null>(null);
  const openAdd = useCallback((r: AddRequest) => setAdd(r), []);
  const closeAdd = useCallback(() => setAdd(null), []);
  const pending = store.pendingCount();
  const syncLabel = store.lastSyncError ? (navigator.onLine ? 'Not synced' : 'Offline') : pending ? 'Syncing…' : 'Synced';
  const showFab = section === 'today' || section === 'diary';
  const current = TABS.find(([k]) => k === section);

  useEffect(() => {
    if (!current) navigate('today');
    document.title = current ? `${current[1]} · Open Nutrition` : 'Open Nutrition';
  }, [current]);

  return (
    <AddFoodContext.Provider value={openAdd}>
      <div className="app">
        <nav className="nav" aria-label="Main">
          <a className="brand" href="#/today">
            <img src="/icon.svg" alt="" width={28} height={28} />
            <span>Open Nutrition</span>
          </a>
          <button className="primary nav-add" onClick={() => openAdd({ day: section === 'diary' && rest[0] ? rest[0] : store.today(), meal: mealForNow() })}>
            <Icon name="plus" /> Log food
          </button>
          {TABS.map(([key, name, icon]) => (
            <a key={key} href={`#/${key}`} className={`nav-item ${section === key ? 'on' : ''}`} aria-current={section === key ? 'page' : undefined}>
              <Icon name={icon} />
              <span className="nav-label">{name}</span>
            </a>
          ))}
          <span className={`sync-state ${store.lastSyncError ? 'error' : ''}`} title={store.lastSyncError ?? syncLabel}>
            <i /> {syncLabel}
          </span>
        </nav>
        <main>
          {section === 'today' && <TodayPage />}
          {section === 'diary' && <DiaryPage day={rest[0]} />}
          {section === 'foods' && <FoodsPage />}
          {section === 'nutrients' && <NutrientsPage day={rest[0]} />}
          {section === 'body' && <BodyPage />}
          {section === 'settings' && <SettingsPage username={auth.username} onLogout={onLogout} focus={rest[0]} />}
        </main>
        {showFab && (
          <button
            className="fab"
            aria-label="Log food"
            onClick={() => openAdd({ day: section === 'diary' && rest[0] ? rest[0] : store.today(), meal: mealForNow() })}
          >
            <Icon name="plus" size={26} />
          </button>
        )}
        {add && <AddFoodSheet request={add} onClose={closeAdd} />}
      </div>
    </AddFoodContext.Provider>
  );
}
