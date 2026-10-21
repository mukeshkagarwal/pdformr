import { useEffect, useState } from 'react';

export interface ToastAction {
  label: string;
  run: () => void;
}

export interface ToastApi {
  show: (msg: string, opts?: { kind?: 'info' | 'error'; action?: ToastAction; ms?: number }) => void;
}

interface Item {
  id: number;
  msg: string;
  kind: 'info' | 'error';
  action?: ToastAction;
}

let seq = 0;

export function Toasts({ onReady }: { onReady: (api: ToastApi) => void }) {
  const [items, setItems] = useState<Item[]>([]);

  useEffect(() => {
    onReady({
      show(msg, opts = {}) {
        const id = ++seq;
        setItems((xs) => [...xs, { id, msg, kind: opts.kind ?? 'info', action: opts.action }]);
        setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), opts.ms ?? (opts.action ? 9000 : 3500));
      },
    });
  }, [onReady]);

  const dismiss = (id: number) => setItems((xs) => xs.filter((x) => x.id !== id));

  return (
    <div className="toasts" role="status" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          <span>{t.msg}</span>
          {t.action && (
            <button
              className="btn sm primary"
              onClick={() => {
                t.action!.run();
                dismiss(t.id);
              }}
            >
              {t.action.label}
            </button>
          )}
          <button className="btn sm ghost" aria-label="Dismiss" onClick={() => dismiss(t.id)}>
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
