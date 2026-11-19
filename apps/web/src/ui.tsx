import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { addDays, MEALS, parseDay, todayLocal, type Meal } from '@open-nutrition/shared';

// ---------------------------------------------------------------------------
// Icons (simple 24×24 stroke glyphs)
// ---------------------------------------------------------------------------

const ICONS = {
  today: 'M12 3v2M12 19v2M5 12H3M21 12h-2M6.3 6.3 4.9 4.9M19.1 19.1l-1.4-1.4M6.3 17.7l-1.4 1.4M19.1 4.9l-1.4 1.4M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
  diary: 'M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3V4zM5 17a3 3 0 0 1 3-3h11M9 8h6',
  foods: 'M12 7c-1.5-2.5-6-2.5-7 1.5-.8 3.4 1.5 9.5 4.5 11 1 .5 1.8 0 2.5-.5.7.5 1.5 1 2.5.5 3-1.5 5.3-7.6 4.5-11-1-4-5.5-4-7-1.5zM12 7c0-2 1-3.5 3-4',
  report: 'M4 20h16M7 16V10M12 16V5M17 16v-4',
  body: 'M12 5a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM4 21l3-12h10l3 12M9 9l3 4 3-4',
  settings:
    'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  plus: 'M12 5v14M5 12h14',
  close: 'M6 6l12 12M18 6 6 18',
  left: 'M15 18l-6-6 6-6',
  right: 'M9 18l6-6-6-6',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4',
  barcode: 'M4 6v12M7 6v12M10 6v12M14 6v12M17 6v12M20 6v12',
  camera: 'M4 8h3l2-3h6l2 3h3v11H4V8zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  bolt: 'M13 2 4 14h7l-1 8 9-12h-7l1-8z',
  bowl: 'M3 11h18a9 9 0 0 1-18 0zM8 7c0-1 1-1 1-2M12 7c0-1 1-1 1-2M16 7c0-1 1-1 1-2',
  star: 'M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9L12 3z',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  drop: 'M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z',
  calendar: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',
  edit: 'M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  minus: 'M5 12h14',
  check: 'M5 12l5 5 9-10',
  history: 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2',
} as const;

export type IconName = keyof typeof ICONS;

export function Icon({ name, size = 22, filled = false }: { name: IconName; size?: number; filled?: boolean }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={name === 'more' ? 3.2 : 1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="icon"
    >
      <path d={ICONS[name]} />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Modal / sheet
// ---------------------------------------------------------------------------

const modalStack: object[] = [];

export function Modal({
  title,
  onClose,
  children,
  wide = false,
  footer,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
  footer?: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const token = {};
    modalStack.push(token);
    const on = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && modalStack[modalStack.length - 1] === token) closeRef.current();
    };
    window.addEventListener('keydown', on);
    document.body.classList.add('modal-open');
    return () => {
      window.removeEventListener('keydown', on);
      modalStack.splice(modalStack.indexOf(token), 1);
      if (!modalStack.length) document.body.classList.remove('modal-open');
    };
  }, []);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <Icon name="close" />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Layout helpers
// ---------------------------------------------------------------------------

/** Width of an element, tracked with ResizeObserver (for charts sized to their container). */
export function useElementWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(el.clientWidth);
    const ro = new ResizeObserver((entries) => {
      const cw = entries[0]?.contentRect.width;
      if (cw != null) setW(Math.round(cw));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: readonly (readonly [T, string])[];
  onChange: (v: T) => void;
  label?: string;
}) {
  return (
    <div className="segmented" role="tablist" aria-label={label}>
      {options.map(([v, l]) => (
        <button key={v} role="tab" aria-selected={v === value} className={v === value ? 'on' : ''} onClick={() => onChange(v)}>
          {l}
        </button>
      ))}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>;
}

// ---------------------------------------------------------------------------
// Meals and days
// ---------------------------------------------------------------------------

export const MEAL_LABEL: Record<Meal, string> = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snack: 'Snacks' };

/** A sensible default meal for the current time of day. */
export function mealForNow(d = new Date()): Meal {
  const h = d.getHours();
  if (h < 10) return 'breakfast';
  if (h < 15) return 'lunch';
  if (h < 21) return 'dinner';
  return 'snack';
}

export function MealSelect({ value, onChange, id }: { value: Meal; onChange: (m: Meal) => void; id?: string }) {
  return (
    <select id={id} value={value} onChange={(e) => onChange(e.target.value as Meal)}>
      {MEALS.map((m) => (
        <option key={m} value={m}>
          {MEAL_LABEL[m]}
        </option>
      ))}
    </select>
  );
}

export function dayLabel(day: string, long = false): string {
  const today = todayLocal();
  if (day === today) return 'Today';
  if (day === addDays(today, -1)) return 'Yesterday';
  if (day === addDays(today, 1)) return 'Tomorrow';
  return parseDay(day).toLocaleDateString(undefined, long ? { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' } : { weekday: 'short', month: 'short', day: 'numeric' });
}

export function DayNav({ day, onChange, onOpenCalendar }: { day: string; onChange: (d: string) => void; onOpenCalendar?: () => void }) {
  return (
    <div className="day-nav">
      <button className="icon-btn" onClick={() => onChange(addDays(day, -1))} aria-label="Previous day">
        <Icon name="left" />
      </button>
      <button className="day-label" onClick={onOpenCalendar} aria-label="Pick a date">
        <span>{dayLabel(day)}</span>
        <small>{parseDay(day).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</small>
      </button>
      <button className="icon-btn" onClick={() => onChange(addDays(day, 1))} aria-label="Next day">
        <Icon name="right" />
      </button>
    </div>
  );
}

const pad = (n: number) => String(n).padStart(2, '0');
const isoOf = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;

/** Month calendar; `marked` days get a dot. */
export function Calendar({ value, onPick, marked }: { value: string; onPick: (d: string) => void; marked?: Set<string> }) {
  const v = parseDay(value);
  const [ym, setYm] = useState({ y: v.getFullYear(), m: v.getMonth() });
  useEffect(() => {
    const d = parseDay(value);
    setYm({ y: d.getFullYear(), m: d.getMonth() });
  }, [value]);
  const first = new Date(ym.y, ym.m, 1);
  const offset = (first.getDay() + 6) % 7; // Monday first
  const days = new Date(ym.y, ym.m + 1, 0).getDate();
  const today = todayLocal();
  const cells: (number | null)[] = [...Array(offset).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  const shift = (n: number) => setYm(({ y, m }) => ({ y: m + n < 0 ? y - 1 : m + n > 11 ? y + 1 : y, m: (m + n + 12) % 12 }));
  return (
    <div className="calendar">
      <div className="cal-head">
        <button className="icon-btn" onClick={() => shift(-1)} aria-label="Previous month">
          <Icon name="left" />
        </button>
        <strong>{first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</strong>
        <button className="icon-btn" onClick={() => shift(1)} aria-label="Next month">
          <Icon name="right" />
        </button>
      </div>
      <div className="cal-grid">
        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
          <span key={i} className="cal-dow">
            {d}
          </span>
        ))}
        {cells.map((d, i) => {
          if (d == null) return <span key={i} />;
          const iso = isoOf(ym.y, ym.m, d);
          return (
            <button
              key={i}
              className={`cal-day ${iso === value ? 'on' : ''} ${iso === today ? 'today' : ''}`}
              onClick={() => onPick(iso)}
              aria-label={iso}
              aria-pressed={iso === value}
            >
              {d}
              {marked?.has(iso) && <i className="cal-dot" />}
            </button>
          );
        })}
      </div>
      {value !== today && (
        <button className="link small" onClick={() => onPick(today)}>
          Jump to today
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------

export const round = (v: number, digits = 0) => +v.toFixed(digits);
export const kcal = (v: number | undefined) => Math.round(v ?? 0).toLocaleString();
export const grams = (v: number | undefined) => {
  const x = v ?? 0;
  return x >= 10 ? String(Math.round(x)) : String(round(x, 1));
};

/** Parse a user-typed decimal ("1,5" works too); null when empty or invalid. */
export function num(s: string): number | null {
  const t = s.trim().replace(',', '.');
  if (!t) return null;
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
}

/** A controlled decimal input that keeps the user's partial text ("1.", "") while typing. */
export function NumberInput({
  value,
  onChange,
  id,
  min = 0,
  placeholder,
  ariaLabel,
  className,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  id?: string;
  min?: number;
  placeholder?: string;
  ariaLabel?: string;
  className?: string;
}) {
  const [text, setText] = useState(value == null ? '' : String(value));
  useEffect(() => {
    if (num(text) !== value) setText(value == null ? '' : String(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <input
      id={id}
      className={className}
      inputMode="decimal"
      value={text}
      placeholder={placeholder}
      aria-label={ariaLabel}
      onChange={(e) => {
        setText(e.target.value);
        const v = num(e.target.value);
        onChange(v == null ? null : Math.max(min, v));
      }}
    />
  );
}

export function Bar({ value, max, status, label }: { value: number; max: number; status?: string; label?: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className={`bar-track ${status ?? ''}`} role="progressbar" aria-valuenow={Math.round(value)} aria-valuemax={Math.round(max)} aria-label={label}>
      <div className="bar-fill" style={{ width: `${pct}%` }} />
    </div>
  );
}

export function download(filename: string, content: string | Blob, type = 'text/plain') {
  const blob = typeof content === 'string' ? new Blob([content], { type }) : content;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
