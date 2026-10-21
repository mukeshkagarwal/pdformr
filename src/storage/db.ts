import { createStore, get, set, del, keys, entries, setMany, clear, type UseStore } from 'idb-keyval';
import type { DocRecord } from '../types';
import { LEGACY_DB, dbName, getScope } from './scope';

const stores = new Map<string, UseStore>();
/** The current user's store (see scope.ts). */
function store(): UseStore {
  const name = dbName(getScope());
  let s = stores.get(name);
  if (!s) stores.set(name, (s = createStore(name, 'kv')));
  return s;
}

const MIGRATED = 'pdf-form-editor:legacy-migrated';

/**
 * Forms saved before sign-in existed live in an unscoped database. The first account
 * to sign in on this browser adopts them (once), so nothing is lost.
 */
export async function adoptLegacyData(): Promise<number> {
  try {
    if (localStorage.getItem(MIGRATED)) return 0;
    const legacy = createStore(LEGACY_DB, 'kv');
    const items = await entries(legacy);
    if (items.length && (await keys(store())).length === 0) await setMany(items, store());
    if (items.length) await clear(legacy);
    localStorage.setItem(MIGRATED, getScope());
    return items.filter(([k]) => String(k).startsWith('doc:')).length;
  } catch {
    return 0;
  }
}

/** Removes this user's local workspace (all saved forms) from the browser. */
export function deleteWorkspace(userId: string): Promise<void> {
  stores.delete(dbName(userId));
  return new Promise((resolve) => {
    const req = indexedDB.deleteDatabase(dbName(userId));
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  });
}
const DOC = 'doc:';
const PDF = 'pdf:';

const norm = (name: string) => name.trim().toLowerCase();

export async function listDocs(): Promise<DocRecord[]> {
  const all = (await keys(store())) as string[];
  const docs = await Promise.all(
    all.filter((k) => k.startsWith(DOC)).map((k) => get<DocRecord>(k, store())),
  );
  return docs.filter((d): d is DocRecord => !!d).sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function findDoc(name: string): Promise<DocRecord | undefined> {
  return get<DocRecord>(DOC + norm(name), store());
}

export async function getPdfBytes(name: string): Promise<ArrayBuffer | undefined> {
  return get<ArrayBuffer>(PDF + norm(name), store());
}

export async function saveDoc(doc: DocRecord): Promise<number> {
  const updatedAt = Date.now();
  await set(DOC + norm(doc.name), { ...doc, updatedAt }, store());
  return updatedAt;
}

export async function createDoc(doc: DocRecord, bytes: ArrayBuffer): Promise<void> {
  await set(PDF + norm(doc.name), bytes, store());
  await set(DOC + norm(doc.name), doc, store());
}

export async function deleteDoc(name: string): Promise<void> {
  await del(DOC + norm(name), store());
  await del(PDF + norm(name), store());
}
