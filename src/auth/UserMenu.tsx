import { useEffect, useRef, useState } from 'react';
import { useAuth } from './AuthGate';

/** Avatar button with the signed-in user's details and sign-out options. */
export function UserMenu() {
  const { user, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', close);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', close);
    };
  }, [open]);

  const initials = user.name
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="user-menu pop-anchor" ref={ref}>
      <button className="avatar-btn" onClick={() => setOpen((o) => !o)} aria-expanded={open} title={user.email ?? user.name}>
        {user.avatar ? <img src={user.avatar} alt="" referrerPolicy="no-referrer" /> : <span className="initials">{initials || '?'}</span>}
        {user.offline && <span className="offline-dot" title="Offline" />}
      </button>
      {open && (
        <div className="popover right" role="menu">
          <div className="who">
            <b className="ellipsis">{user.name}</b>
            {user.email && <span className="muted sm ellipsis">{user.email}</span>}
            {user.provider && <span className="muted sm">via {user.provider[0].toUpperCase() + user.provider.slice(1)}</span>}
            {user.offline && <span className="warn sm">Offline — using your saved sign-in</span>}
            {user.local && <span className="warn sm">Sign-in not configured (dev mode)</span>}
          </div>
          {!user.local && (
            <>
              <button className="menu-item" role="menuitem" onClick={() => signOut()}>
                Sign out
              </button>
              <button
                className="menu-item danger"
                role="menuitem"
                onClick={() => confirm('Sign out and delete all your saved forms from this browser? Export anything you want to keep first.') && signOut({ clearData: true })}
              >
                Sign out &amp; remove my forms from this device
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
