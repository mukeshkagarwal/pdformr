import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import {
  clearStoredSession, forgetUser, lastUser, secretKeyMisuse, rememberUser, signIn, supabase, touchProfile, userFromSession,
  type AppUser, type Provider,
} from './supabase';
import { setScope } from '../storage/scope';
import { APP_NAME } from '../brand';
import { adoptLegacyData, deleteWorkspace } from '../storage/db';

interface AuthApi {
  user: AppUser;
  signOut: (opts?: { clearData?: boolean }) => Promise<void>;
}

const Ctx = createContext<AuthApi | null>(null);

export function useAuth(): AuthApi {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth outside AuthGate');
  return v;
}

type State = { kind: 'loading' } | { kind: 'signedOut'; error?: string } | { kind: 'in'; user: AppUser } | { kind: 'misconfigured' };

const isNetworkError = (e: unknown) =>
  !navigator.onLine || /fetch|network|Failed to fetch|Load failed/i.test(String((e as Error)?.message ?? e));

/** Shows the sign-in screen until a user is signed in, then renders the app for them. */
export function AuthGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [ready, setReady] = useState<string | null>(null); // user id whose workspace is prepared

  useEffect(() => {
    if (secretKeyMisuse) {
      setState({ kind: 'misconfigured' });
      return;
    }
    if (!supabase) {
      // Without Supabase settings the app still runs locally during development.
      setState(import.meta.env.DEV ? { kind: 'in', user: { id: 'local', email: null, name: 'Local (sign-in not configured)', avatar: null, provider: null, local: true } } : { kind: 'misconfigured' });
      return;
    }
    // Errors coming back from the OAuth provider land in the URL.
    const params = new URLSearchParams(window.location.search + window.location.hash.replace(/^#/, '&'));
    const urlError = params.get('error_description');
    if (urlError) window.history.replaceState(null, '', window.location.pathname);

    let live = true;
    const goOffline = () => {
      const last = lastUser();
      if (!last) return false;
      setState({ kind: 'in', user: { ...last, offline: true } });
      return true;
    };
    // No network: don't wait for supabase-js to retry a token refresh (up to ~30 s).
    if (!navigator.onLine && goOffline()) live = false;
    const slow = setTimeout(() => {
      if (live && goOffline()) live = false;
    }, 6000);
    supabase.auth.getSession().then(({ data, error }) => {
      clearTimeout(slow);
      if (!live) {
        // Opened offline; upgrade to the real session if it turned out to be valid.
        if (data.session) setState({ kind: 'in', user: userFromSession(data.session) });
        return;
      }
      if (data.session) {
        const u = userFromSession(data.session);
        rememberUser(u);
        setState({ kind: 'in', user: u });
      } else {
        const last = lastUser();
        if (last && (error ? isNetworkError(error) : !navigator.onLine)) setState({ kind: 'in', user: { ...last, offline: true } });
        else setState({ kind: 'signedOut', error: urlError ?? undefined });
      }
    });

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' && session) {
        const u = userFromSession(session);
        rememberUser(u);
        setState({ kind: 'in', user: u });
        touchProfile(u).catch(() => {});
      } else if (event === 'TOKEN_REFRESHED' && session) {
        setState((s) => (s.kind === 'in' && s.user.offline ? { kind: 'in', user: userFromSession(session) } : s));
      } else if (event === 'SIGNED_OUT') {
        // A failed token refresh while offline must not lock the user out.
        const last = lastUser();
        if (!navigator.onLine && last) setState({ kind: 'in', user: { ...last, offline: true } });
        else setState({ kind: 'signedOut' });
      }
    });
    return () => {
      live = false;
      clearTimeout(slow);
      sub.subscription.unsubscribe();
    };
  }, []);

  // Point local storage at this user's workspace before the app renders.
  const user = state.kind === 'in' ? state.user : null;
  useEffect(() => {
    if (!user) return setReady(null);
    setScope(user.id);
    let live = true;
    adoptLegacyData().finally(() => live && setReady(user.id));
    return () => {
      live = false;
    };
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (state.kind === 'misconfigured')
    return (
      <SignInScreen
        disabled
        error={
          secretKeyMisuse
            ? 'A Supabase SECRET key is configured. Never put the secret / service_role key in this app — use the publishable key (sb_publishable_…) in VITE_SUPABASE_PUBLISHABLE_KEY, and rotate the secret key in Supabase.'
            : "Sign-in isn't configured for this deployment (missing VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY)."
        }
      />
    );
  if (state.kind === 'loading' || (user && ready !== user.id)) return <div className="center-msg"><span className="spinner" /> Loading…</div>;
  if (state.kind === 'signedOut') return <SignInScreen error={state.error} />;

  const api: AuthApi = {
    user: user!,
    async signOut(opts) {
      const id = user!.id;
      forgetUser();
      // 'local' scope works offline and only ends this browser's session.
      await supabase?.auth.signOut({ scope: 'local' }).catch(() => {});
      // supabase-js keeps the session if the sign-out request fails (e.g. offline); drop it anyway.
      clearStoredSession();
      if (opts?.clearData) await deleteWorkspace(id);
      try {
        Object.keys(sessionStorage).filter((k) => k.endsWith(`:${id}`)).forEach((k) => sessionStorage.removeItem(k));
      } catch {
        /* ignore */
      }
      window.location.reload();
    },
  };
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

function SignInScreen({ error, disabled }: { error?: string; disabled?: boolean }) {
  const [busy, setBusy] = useState<Provider | null>(null);
  const [err, setErr] = useState<string | undefined>(error);
  const offline = !navigator.onLine;

  const go = async (p: Provider) => {
    setBusy(p);
    setErr(undefined);
    try {
      await signIn(p); // navigates away to the provider
    } catch (e) {
      setErr(String((e as Error).message ?? e));
      setBusy(null);
    }
  };

  return (
    <div className="signin">
      <div className="signin-card">
        <img src="./icon.svg" alt="" width={44} height={44} />
        <h1>{APP_NAME}</h1>
        <p className="muted">Sign in to continue</p>
        <button className="btn oauth" disabled={disabled || offline || !!busy} onClick={() => go('google')}>
          <GoogleIcon /> {busy === 'google' ? 'Redirecting…' : 'Continue with Google'}
        </button>
        <button className="btn oauth" disabled={disabled || offline || !!busy} onClick={() => go('facebook')}>
          <FacebookIcon /> {busy === 'facebook' ? 'Redirecting…' : 'Continue with Facebook'}
        </button>
        {offline && <p className="warn sm">You're offline. Signing in needs a connection the first time; after that the app works offline.</p>}
        {err && <p className="warn sm" role="alert">{err}</p>}
        <p className="muted sm">Your PDFs and form data stay on this device. Sign-in only identifies you.</p>
      </div>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 38.4 44 33 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

function FacebookIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden>
      <circle cx="12" cy="12" r="12" fill="#1877F2" />
      <path fill="#fff" d="M15.1 12.6l.4-2.7h-2.6V8.2c0-.8.4-1.5 1.6-1.5h1.2V4.4s-1.1-.2-2.2-.2c-2.2 0-3.7 1.4-3.7 3.8v2h-2.4v2.7h2.4V19h3V12.6h2.3z" />
    </svg>
  );
}
