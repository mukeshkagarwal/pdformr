import { useCallback, useEffect, useState } from 'react';
import { StartScreen } from './components/StartScreen';
import { Editor } from './components/Editor';
import { Toasts, type ToastApi } from './components/Toasts';
import { findDoc } from './storage/db';
import { getActiveDoc, setActiveDoc } from './storage/tabSession';
import type { FormDataFile } from './types';
import { registerSW } from 'virtual:pwa-register';
import { APP_NAME } from './brand';

export default function App() {
  const [active, setActive] = useState<string | null | undefined>(undefined);
  const [pendingImport, setPendingImport] = useState<FormDataFile | null>(null);
  const [toast, setToast] = useState<ToastApi>({ show: (m) => console.info(m) });

  useEffect(() => {
    const name = getActiveDoc();
    if (!name) return setActive(null);
    findDoc(name).then((d) => setActive(d ? d.name : null));
  }, []);

  const open = useCallback((name: string, data?: FormDataFile) => {
    setActiveDoc(name);
    setPendingImport(data ?? null);
    setActive(name);
  }, []);

  const close = useCallback(() => {
    setActiveDoc(null);
    setActive(null);
  }, []);

  // Offline support: the service worker caches the whole app on first visit.
  const [toastReady, setToastReady] = useState(false);
  const onToastReady = useCallback((api: ToastApi) => {
    setToast(api);
    setToastReady(true);
  }, []);
  useEffect(() => {
    if (!toastReady || !('serviceWorker' in navigator)) return;
    const update = registerSW({
      onOfflineReady() {
        toast.show('Ready to work offline — the app is saved in this browser.');
      },
      onNeedRefresh() {
        toast.show('A new version is available.', {
          action: { label: 'Reload', run: () => update(true) },
          ms: 60000,
        });
      },
    });
  }, [toastReady]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    document.title = active ? `${active} · ${APP_NAME}` : APP_NAME;
  }, [active]);

  return (
    <>
      {active === undefined ? null : active ? (
        <Editor key={active} name={active} onClose={close} toast={toast} pendingImport={pendingImport} onImportConsumed={() => setPendingImport(null)} />
      ) : (
        <StartScreen onOpen={open} toast={toast} />
      )}
      <Toasts onReady={onToastReady} />
    </>
  );
}
