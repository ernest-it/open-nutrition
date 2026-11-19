import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Icon, Modal } from './ui';

// ---------------------------------------------------------------------------
// The app's own replacement for window.confirm / alert / prompt:
//   const ask = useConfirm();  if (await ask({ title, body, confirmLabel, destructive: true })) …
//   const toast = useToast();      toast({ message, action: { label: 'Undo', onClick } })
// Both render inside <FeedbackProvider>, themed and accessible (focus trap, Esc, aria roles).
// ---------------------------------------------------------------------------

export interface ConfirmOptions {
  title: string;
  body?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Red confirm button; initial focus goes to Cancel so Enter never destroys by accident. */
  destructive?: boolean;
}

export interface ToastOptions {
  message: ReactNode;
  /** e.g. { label: 'Undo', onClick } — clicking it runs the action and dismisses the toast. */
  action?: { label: string; onClick: () => void };
  tone?: 'default' | 'success' | 'error';
  /** ms before auto-dismiss; default 5 s, 8 s with an action. 0 = stay until dismissed. */
  duration?: number;
}

type ToastItem = ToastOptions & { id: number };

interface FeedbackApi {
  confirm: (o: ConfirmOptions) => Promise<boolean>;
  toast: (o: ToastOptions | string) => number;
  dismiss: (id: number) => void;
}

const FeedbackContext = createContext<FeedbackApi>({
  confirm: async () => false,
  toast: () => 0,
  dismiss: () => {},
});

export const useConfirm = () => useContext(FeedbackContext).confirm;
export const useToast = () => useContext(FeedbackContext).toast;

let nextId = 1;

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [pending, setPending] = useState<(ConfirmOptions & { resolve: (v: boolean) => void }) | null>(null);

  const dismiss = useCallback((id: number) => setToasts((ts) => ts.filter((t) => t.id !== id)), []);
  const toast = useCallback((o: ToastOptions | string) => {
    const item: ToastItem = { ...(typeof o === 'string' ? { message: o } : o), id: nextId++ };
    // Keep at most three on screen; the newest goes at the bottom.
    setToasts((ts) => [...ts.slice(-2), item]);
    return item.id;
  }, []);
  const confirm = useCallback(
    (o: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        setPending((prev) => {
          prev?.resolve(false);
          return { ...o, resolve };
        });
      }),
    [],
  );
  const api = useMemo(() => ({ confirm, toast, dismiss }), [confirm, toast, dismiss]);

  const settle = (v: boolean) => {
    pending?.resolve(v);
    setPending(null);
  };

  return (
    <FeedbackContext.Provider value={api}>
      {children}
      {pending && <ConfirmDialog {...pending} onSettle={settle} />}
      <div className="toasts" role="region" aria-label="Notifications">
        {toasts.map((t) => (
          <Toast key={t.id} item={t} onDismiss={() => dismiss(t.id)} />
        ))}
      </div>
    </FeedbackContext.Provider>
  );
}

function ConfirmDialog({ title, body, confirmLabel = 'OK', cancelLabel = 'Cancel', destructive, onSettle }: ConfirmOptions & { onSettle: (v: boolean) => void }) {
  return (
    <Modal
      title={title}
      onClose={() => onSettle(false)}
      variant="alert"
      describedBy={body ? 'confirm-body' : undefined}
      footer={
        <>
          <button onClick={() => onSettle(false)} data-autofocus={destructive ? true : undefined}>
            {cancelLabel}
          </button>
          <button className={destructive ? 'danger solid' : 'primary'} onClick={() => onSettle(true)} data-autofocus={destructive ? undefined : true}>
            {confirmLabel}
          </button>
        </>
      }
    >
      {body && (
        <div id="confirm-body" className="confirm-body">
          {body}
        </div>
      )}
    </Modal>
  );
}

function Toast({ item, onDismiss }: { item: ToastItem; onDismiss: () => void }) {
  const duration = item.duration ?? (item.action ? 8000 : 5000);
  const [paused, setPaused] = useState(false);
  const left = useRef(duration);
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;
  useEffect(() => {
    if (!duration || paused) return;
    const start = Date.now();
    const t = setTimeout(() => dismissRef.current(), left.current);
    return () => {
      clearTimeout(t);
      left.current -= Date.now() - start;
    };
  }, [paused, duration]);
  return (
    <div
      className={`toast ${item.tone ?? 'default'}`}
      role={item.tone === 'error' ? 'alert' : 'status'}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      {item.tone === 'success' && <Icon name="check" size={18} />}
      {item.tone === 'error' && <Icon name="alert" size={18} />}
      <span className="toast-msg">{item.message}</span>
      {item.action && (
        <button
          className="toast-action"
          onClick={() => {
            item.action!.onClick();
            onDismiss();
          }}
        >
          {item.action.label}
        </button>
      )}
      <button className="toast-close" onClick={onDismiss} aria-label="Dismiss">
        <Icon name="close" size={16} />
      </button>
    </div>
  );
}

/** An inline error or warning next to the thing it is about (announced to screen readers). */
export function InlineError({ children, id, className = '' }: { children: ReactNode; id?: string; className?: string }) {
  if (!children) return null;
  return (
    <p className={`inline-error ${className}`} role="alert" id={id}>
      <Icon name="alert" size={16} />
      <span>{children}</span>
    </p>
  );
}

/** Small inline spinner for busy buttons. */
export function Spinner({ label }: { label?: string }) {
  return <span className="spinner" role={label ? 'status' : undefined} aria-label={label} aria-hidden={label ? undefined : true} />;
}
