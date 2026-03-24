import { useAuth } from '../context/AuthContext';
import { ShimmerButton } from './ui/shimmer-button';

export function UserProfile() {
  const { user, login, logout, switchAccount, authBootState } = useAuth();

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

  return (
    <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-3 max-w-full">
      {user.picture && (
        <img
          src={user.picture}
          alt={user.name}
          className="w-7 h-7 sm:w-8 sm:h-8 rounded-full border border-brand-400"
        />
      )}
      <div className="hidden sm:block min-w-0 text-sm text-right">
        <p className="font-medium text-white max-w-[10rem] truncate">{user.name}</p>
        <p className="text-xs text-gray-400 max-w-[12rem] truncate">{user.email}</p>
      </div>
      <div className="flex items-center gap-1.5 sm:gap-2">
        <ShimmerButton
          onClick={switchAccount}
          background="rgba(20, 20, 30, 0.95)"
          shimmerColor="#5c7cfa"
          className="dark:text-white text-[11px] sm:text-xs font-semibold px-2.5 py-1 whitespace-nowrap"
        >
          Switch
        </ShimmerButton>
        <ShimmerButton
          onClick={logout}
          background="rgba(220, 38, 38, 1)"
          shimmerColor="#ffffff"
          className="dark:text-white text-[11px] sm:text-xs font-semibold px-2.5 py-1 whitespace-nowrap"
        >
          Logout
        </ShimmerButton>
      </div>
    </div>
  );
}
