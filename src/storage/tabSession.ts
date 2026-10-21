import { getScope } from './scope';

// sessionStorage is scoped to a single tab, so each tab keeps its own active document.
const key = () => `pdf-form-editor:active-doc:${getScope()}`;

export const tabId = Math.random().toString(36).slice(2);

export function getActiveDoc(): string | null {
  try {
    return sessionStorage.getItem(key());
  } catch {
    return null;
  }
}

export function setActiveDoc(name: string | null): void {
  try {
    if (name) sessionStorage.setItem(key(), name);
    else sessionStorage.removeItem(key());
  } catch {
    /* ignore */
  }
}

export interface SyncMessage {
  tab: string;
  doc: string; // normalized name
  updatedAt: number;
}

// One channel per user, so tabs of different users never exchange updates.
const channels = new Map<string, BroadcastChannel>();
function chan(): BroadcastChannel | null {
  if (typeof BroadcastChannel === 'undefined') return null;
  const name = `pdf-form-editor:${getScope()}`;
  let c = channels.get(name);
  if (!c) channels.set(name, (c = new BroadcastChannel(name)));
  return c;
}

export function broadcastChange(doc: string, updatedAt: number) {
  chan()?.postMessage({ tab: tabId, doc: doc.trim().toLowerCase(), updatedAt } satisfies SyncMessage);
}

export function onRemoteChange(cb: (m: SyncMessage) => void): () => void {
  const channel = chan();
  if (!channel) return () => {};
  const h = (e: MessageEvent<SyncMessage>) => {
    if (e.data?.tab !== tabId) cb(e.data);
  };
  channel.addEventListener('message', h);
  return () => channel.removeEventListener('message', h);
}
