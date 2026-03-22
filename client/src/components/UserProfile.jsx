import { useAuth } from '../context/AuthContext';
import { ShimmerButton } from './ui/shimmer-button';

export function UserProfile() {
  const { user, login, logout, switchAccount } = useAuth();

  if (!user) {
    return (
      <ShimmerButton
        onClick={() => login()}
        background="rgba(20, 20, 30, 0.95)"
        shimmerColor="#5c7cfa"
        className="dark:text-white text-sm font-semibold px-4 py-2"
      >
        Sign In
      </ShimmerButton>
    );
  }

  return (
    <div className="flex items-center gap-3">
      {user.picture && (
        <img
          src={user.picture}
          alt={user.name}
          className="w-8 h-8 rounded-full border border-brand-400"
        />
      )}
      <div className="text-sm">
        <p className="font-medium text-white">{user.name}</p>
        <p className="text-xs text-gray-400">{user.email}</p>
      </div>
      <div className="flex items-center gap-2">
        <ShimmerButton
          onClick={switchAccount}
          background="rgba(20, 20, 30, 0.95)"
          shimmerColor="#5c7cfa"
          className="dark:text-white text-xs font-semibold px-3 py-1"
        >
          Switch
        </ShimmerButton>
        <ShimmerButton
          onClick={logout}
          background="rgba(220, 38, 38, 1)"
          shimmerColor="#ffffff"
          className="dark:text-white text-xs font-semibold px-3 py-1"
        >
          Logout
        </ShimmerButton>
      </div>
    </div>
  );
}
