import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { ShimmerButton } from './ui/shimmer-button';

export function UserProfile() {
  const { user, login, logout, switchAccount, authBootState } = useAuth();
  const [open, setOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event) => {
      if (!menuRef.current?.contains(event.target)) {
        setOpen(false);
      }
    };

    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('touchstart', onPointerDown);
    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  if (!user) {
    return (
      <ShimmerButton
        onClick={() => login()}
        disabled={authBootState.active}
        background="rgba(20, 20, 30, 0.95)"
        shimmerColor="#5c7cfa"
        className="dark:text-white text-xs sm:text-sm font-semibold px-3 py-1.5 sm:px-4 sm:py-2 whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-70"
      >
        {authBootState.active ? 'Starting...' : 'Sign In'}
      </ShimmerButton>
    );
  }

  const initials = user.name?.trim()?.charAt(0)?.toUpperCase() || 'U';

  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="h-9 w-9 overflow-hidden rounded-full border border-brand-400/80 bg-brand-700/30 transition hover:border-brand-300 focus:outline-none focus:ring-2 focus:ring-brand-400/70"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Open account menu"
      >
        {user.picture ? (
          <img
            src={user.picture}
            alt={user.name || 'Profile'}
            className="h-full w-full object-cover"
          />
        ) : (
          <span className="inline-flex h-full w-full items-center justify-center text-sm font-semibold text-white">
            {initials}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-30 mt-2 w-64 rounded-2xl border border-white/10 bg-slate-950/95 p-3 shadow-2xl backdrop-blur-sm">
          <div className="mb-3 border-b border-white/10 pb-3 text-left">
            <p className="truncate text-sm font-semibold text-white">{user.name}</p>
            <p className="truncate text-xs text-gray-400">{user.email}</p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                switchAccount();
              }}
              className="flex-1 rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-xs font-semibold text-white transition hover:bg-white/10"
            >
              Switch
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                logout();
              }}
              className="flex-1 rounded-lg border border-red-400/40 bg-red-500/15 px-3 py-2 text-xs font-semibold text-red-100 transition hover:bg-red-500/25"
            >
              Logout
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
