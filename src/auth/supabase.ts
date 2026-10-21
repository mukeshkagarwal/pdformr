import { createClient, type Session } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
// Publishable key (sb_publishable_…); the legacy anon key is still accepted.
const key = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY) as string | undefined;

/**
 * A secret / service_role key bypasses row level security. In a browser app anyone could
 * read it, so refuse to run with one rather than leak it.
 */
function isSecretKey(k: string): boolean {
  if (k.startsWith('sb_secret_')) return true;
  try {
    const payload = JSON.parse(atob(k.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return payload?.role === 'service_role';
  } catch {
    return false;
  }
}

export const secretKeyMisuse = !!key && isSecretKey(key);

/** False when the Supabase env vars are missing (see .env.example). */
export const authConfigured = !!(url && key) && !secretKeyMisuse;

const STORAGE_KEY = 'pdf-form-editor-auth';

/** Removes the persisted Supabase session (and PKCE verifier) from this browser. */
export function clearStoredSession() {
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith(STORAGE_KEY)) localStorage.removeItem(k);
  } catch {
    /* ignore */
  }
}

export const supabase = authConfigured
  ? createClient(url!, key!, {
      auth: {
        flowType: 'pkce',
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storageKey: STORAGE_KEY,
      },
    })
  : null;

export type Provider = 'google' | 'facebook';

export interface AppUser {
  id: string;
  email: string | null;
  name: string;
  avatar: string | null;
  provider: string | null;
  /** Signed in from the cached profile because the network is unavailable. */
  offline?: boolean;
  /** Auth isn't configured (local development only). */
  local?: boolean;
}

export function userFromSession(s: Session): AppUser {
  const u = s.user;
  const m = (u.user_metadata ?? {}) as Record<string, string | undefined>;
  return {
    id: u.id,
    email: u.email ?? null,
    name: m.full_name || m.name || u.email || 'Signed in',
    avatar: m.avatar_url || m.picture || null,
    provider: (u.app_metadata?.provider as string | undefined) ?? null,
  };
}

// The last signed-in user is remembered so the app can still open offline.
const LAST = 'pdf-form-editor:last-user';

export function rememberUser(u: AppUser) {
  try {
    const { offline: _o, local: _l, ...keep } = u;
    localStorage.setItem(LAST, JSON.stringify(keep));
  } catch {
    /* ignore */
  }
}

export function lastUser(): AppUser | null {
  try {
    const v = localStorage.getItem(LAST);
    return v ? (JSON.parse(v) as AppUser) : null;
  } catch {
    return null;
  }
}

export function forgetUser() {
  try {
    localStorage.removeItem(LAST);
  } catch {
    /* ignore */
  }
}

export async function signIn(provider: Provider) {
  if (!supabase) return;
  // Come back to the same page (works on localhost, Vercel previews and production).
  const redirectTo = window.location.origin + window.location.pathname;
  const { error } = await supabase.auth.signInWithOAuth({
    provider,
    options: { redirectTo, scopes: provider === 'facebook' ? 'email public_profile' : undefined },
  });
  if (error) throw error;
}

/** Records the sign-in on the user's profile row (created by a database trigger). */
export async function touchProfile(u: AppUser) {
  if (!supabase || u.offline || u.local) return;
  await supabase
    .from('profiles')
    .update({ last_sign_in_at: new Date().toISOString(), full_name: u.name, avatar_url: u.avatar })
    .eq('id', u.id);
}
